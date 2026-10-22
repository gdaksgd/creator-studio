import { db } from '../db';
import { createRun, refreshRun } from './runService';
import { listRunCostsForRuns, summarizeCosts, type CostSummary } from './costService';
import type { RunBatch, RunBatchItem, RunBatchStatus, RunCostEntry, Script } from '../types';

export type BatchProgress = {
  total: number;
  pending: number;
  running: number;
  done: number;
  failed: number;
};

function now() {
  return Date.now();
}

function defaultTitle(): string {
  return `批量任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`;
}

function clampConcurrency(value?: number): number {
  return Math.min(3, Math.max(1, Math.round(value ?? 2)));
}

export function batchProgress(batch: RunBatch): BatchProgress {
  return {
    total: batch.items.length,
    pending: batch.items.filter((item) => item.status === 'pending').length,
    running: batch.items.filter((item) => item.status === 'running').length,
    done: batch.items.filter((item) => item.status === 'done').length,
    failed: batch.items.filter((item) => item.status === 'failed').length,
  };
}

function batchStatusFromItems(items: RunBatchItem[]): RunBatchStatus {
  if (!items.length) return 'failed';
  if (items.some((item) => item.status === 'pending' || item.status === 'running')) return 'running';
  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'failed').length;
  if (!failed) return 'completed';
  if (!done) return 'failed';
  return 'partial';
}

export interface CreateRunBatchInput {
  title?: string;
  scriptIds: string[];
  concurrency?: number;
  actor?: string;
}

/** 为一组脚本创建 N 条独立 run，并记录批量任务；预检由 executeRunBatch 执行。 */
export async function createRunBatch(input: CreateRunBatchInput): Promise<RunBatch> {
  const scriptIds = [...new Set(input.scriptIds)].filter(Boolean);
  if (!scriptIds.length) throw new Error('至少选择一个脚本');
  const actor = input.actor || '本地用户';
  const scripts = (await db.scripts.bulkGet(scriptIds)).filter(
    (script): script is Script => !!script,
  );
  if (!scripts.length) throw new Error('所选脚本不存在');
  const items: RunBatchItem[] = [];
  for (const script of scripts) {
    try {
      const topic = await db.topics.get(script.topicId);
      const run = await createRun(script, topic, actor);
      items.push({
        runId: run.id,
        scriptId: script.id,
        runTitle: run.title,
        platform: run.platform,
        version: run.version,
        status: 'pending',
        attempts: 0,
      });
    } catch (error) {
      items.push({
        runId: '',
        scriptId: script.id,
        runTitle: script.title,
        platform: script.platform,
        version: script.version,
        status: 'failed',
        attempts: 0,
        error: (error as Error).message,
        updatedAt: now(),
      });
    }
  }
  const batch: RunBatch = {
    id: crypto.randomUUID(),
    title: input.title?.trim() || defaultTitle(),
    items,
    status: 'draft',
    concurrency: clampConcurrency(input.concurrency),
    actor,
    createdAt: now(),
    updatedAt: now(),
  };
  await db.runBatches.put(batch);
  return batch;
}

async function patchBatchItem(
  batchId: string,
  runId: string,
  patch: Partial<RunBatchItem>,
): Promise<void> {
  const batch = await db.runBatches.get(batchId);
  if (!batch) return;
  await db.runBatches.put({
    ...batch,
    items: batch.items.map((item) => (item.runId === runId ? { ...item, ...patch } : item)),
    updatedAt: now(),
  });
}

/**
 * 执行批量预检：并发上限 + 失败重试 2 次。
 * 「done」只表示预检完成，不代表 run 没有阻塞；run 自身状态由详情页/检查项表达。
 */
export async function executeRunBatch(
  batchId: string,
  options: { retryFailedOnly?: boolean; actor?: string } = {},
): Promise<RunBatch> {
  const batch = await db.runBatches.get(batchId);
  if (!batch) throw new Error('批量任务不存在');
  if (batch.status === 'running') return batch;
  const actor = options.actor || batch.actor || '本地用户';
  const targets = batch.items.filter((item) =>
    options.retryFailedOnly ? item.status === 'failed' : item.status === 'pending',
  );
  if (!targets.length) return batch;

  const runningItems = batch.items.map((item) =>
    targets.some((target) => target.runId === item.runId)
      ? { ...item, status: 'running' as const, updatedAt: now() }
      : item,
  );
  await db.runBatches.put({
    ...batch,
    items: runningItems,
    status: 'running',
    updatedAt: now(),
  });

  let cursor = 0;
  let writeChain = Promise.resolve();
  const queuePatch = (runId: string, patch: Partial<RunBatchItem>) => {
    writeChain = writeChain.then(() => patchBatchItem(batchId, runId, patch));
    return writeChain;
  };

  const runOne = async (item: RunBatchItem) => {
    if (!item.runId) {
      await queuePatch(item.runId, {
        status: 'failed',
        error: item.error || '任务创建失败',
        updatedAt: now(),
      });
      return;
    }
    let attempts = item.attempts;
    let lastError = '';
    let status: 'done' | 'failed' = 'failed';
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      attempts += 1;
      try {
        await refreshRun(item.runId, actor);
        status = 'done';
        lastError = '';
        break;
      } catch (error) {
        lastError = (error as Error).message || '预检失败';
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    await queuePatch(item.runId, {
      status,
      attempts,
      error: lastError || undefined,
      updatedAt: now(),
    });
  };

  const workers = Array.from(
    { length: Math.min(batch.concurrency, targets.length) },
    async () => {
      while (true) {
        const index = cursor;
        cursor += 1;
        if (index >= targets.length) return;
        await runOne(targets[index]!);
      }
    },
  );
  await Promise.all(workers);
  await writeChain;

  const updated = await db.runBatches.get(batchId);
  if (!updated) throw new Error('批量任务已被删除');
  const next: RunBatch = {
    ...updated,
    status: batchStatusFromItems(updated.items),
    updatedAt: now(),
  };
  await db.runBatches.put(next);
  return next;
}

export async function listRunBatches(): Promise<RunBatch[]> {
  return db.runBatches.orderBy('updatedAt').reverse().toArray();
}

export async function getRunBatch(id: string): Promise<RunBatch | undefined> {
  return db.runBatches.get(id);
}

export async function deleteRunBatch(id: string): Promise<void> {
  await db.runBatches.delete(id);
}

export async function getBatchCosts(batchId: string): Promise<{
  entries: RunCostEntry[];
  summary: CostSummary;
}> {
  const batch = await db.runBatches.get(batchId);
  if (!batch) return { entries: [], summary: summarizeCosts([]) };
  const entries = await listRunCostsForRuns(batch.items.map((item) => item.runId).filter(Boolean));
  return { entries, summary: summarizeCosts(entries) };
}
