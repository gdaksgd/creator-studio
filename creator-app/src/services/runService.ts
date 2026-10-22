import { db } from '../db';
import {
  ASSET_KIND_LABELS,
  ASSET_STATUS_LABELS,
  GAME_LONGFORM_PIPELINE,
  PLATFORM_LABELS,
  PRODUCTION_PIPELINE,
  getPipeline,
  getRunPipeline,
  inferPipeline,
} from '../config/productionPipeline';
import {
  assetSnapshotFromLibrary,
  evaluateAssetRights,
  getSlotMatchStatus,
  slotKindFromAssetType,
} from './assetRights';
import { buildRunChecks, runPreflight } from './runPreflight';
import type {
  AssetSlot,
  AssetSlotKind,
  AssetSlotStatus,
  Platform,
  ProductionRun,
  RunCheck,
  RunEvent,
  RunEventType,
  RunMediaRecord,
  RunPackRecord,
  RunPublishRef,
  RunReview,
  RunStage,
  RunStageKey,
  RunStatus,
  RunSubtitles,
  RunVoiceBoundary,
  RunVoiceSettings,
  Script,
  Topic,
} from '../types';
import { deleteRunMedia } from './runMedia';
import { deleteRunCosts, recordRunCost } from './costService';

export const MAX_RUN_EVENTS = 200;
const DEFAULT_ACTOR = '本地用户';

function now() {
  return Date.now();
}

function actorName(actor?: string): string {
  return actor?.trim() || DEFAULT_ACTOR;
}

interface RunEventInput {
  type: RunEventType;
  summary: string;
  meta?: RunEvent['meta'];
}

/** 追加事件并保留最近 200 条；已有事件原样保留，绝不覆盖。 */
export function appendRunEvents(
  run: ProductionRun,
  inputs: RunEventInput[],
  actor?: string,
): RunEvent[] {
  const existing = run.events ?? [];
  if (!inputs.length) return existing;
  const at = now();
  const stamped: RunEvent[] = inputs.map((input) => ({
    id: crypto.randomUUID(),
    type: input.type,
    at,
    actor: actorName(actor),
    summary: input.summary,
    ...(input.meta ? { meta: input.meta } : {}),
  }));
  return [...existing, ...stamped].slice(-MAX_RUN_EVENTS);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function snapshotScript(script: Script): Omit<Script, 'history'> {
  const { history: _history, ...rest } = script;
  return clone(rest);
}

function snapshotTopic(topic?: Topic): ProductionRun['snapshot']['topic'] {
  if (!topic) return undefined;
  return clone({
    id: topic.id,
    title: topic.title,
    category: topic.category,
    status: topic.status,
    evaluation: topic.evaluation,
    notes: topic.notes,
    gameDescription: topic.gameDescription,
    productionIdea: topic.productionIdea,
  });
}

function buildAssetSlots(script: Omit<Script, 'history'>): AssetSlot[] {
  return script.storyboards.map((board) => ({
    id: crypto.randomUUID(),
    storyboardId: board.id,
    sceneNumber: board.sceneNumber,
    description: board.description,
    visualDirection: board.visualDirection,
    duration: board.duration,
    kind: 'unspecified',
    status: 'missing',
    note: '',
    matchStatus: 'unmatched',
    rightsStatus: 'unknown',
  }));
}

/** 把槽位关联的素材库记录刷新为最新授权快照；素材删除时保留旧快照但标记 missing。 */
export async function hydrateRunAssetRights(run: ProductionRun): Promise<ProductionRun> {
  const linkedIds = [...new Set(
    run.assetSlots
      .map((slot) => slot.assetId)
      .filter((id): id is string => !!id),
  )];
  const assets = linkedIds.length ? await db.assets.bulkGet(linkedIds) : [];
  const assetById = new Map(
    assets.filter((asset): asset is NonNullable<typeof asset> => !!asset).map((asset) => [asset.id, asset]),
  );
  return {
    ...run,
    assetSlots: run.assetSlots.map((slot) => {
      if (!slot.assetId) {
        return {
          ...slot,
          matchStatus: getSlotMatchStatus(slot),
          rightsStatus: 'unknown' as const,
        };
      }
      const asset = assetById.get(slot.assetId);
      if (!asset) {
        return {
          ...slot,
          matchStatus: 'missing' as const,
          rightsStatus: 'unknown' as const,
        };
      }
      const snapshot = assetSnapshotFromLibrary(asset);
      return {
        ...slot,
        assetSnapshot: snapshot,
        matchStatus: 'matched' as const,
        rightsStatus: evaluateAssetRights(snapshot, run.platform),
      };
    }),
  };
}

export function deriveRunStatus(
  run: Pick<ProductionRun, 'status' | 'checks' | 'review' | 'pack' | 'pipelineId'>,
): RunStatus {
  if (run.status === 'archived') return 'archived';
  if (!run.checks.length) return 'draft';
  if (run.checks.some((check) => check.level === 'block')) return 'blocked';
  const pipeline = getRunPipeline(run);
  if (pipeline.stageKeys.includes('review') && !run.review.approved) return 'review';
  if (run.pack && !run.pack.stale) return 'exported';
  return 'ready';
}

export function computeRunStage(
  run: Pick<
    ProductionRun,
    | 'checks'
    | 'assetSlots'
    | 'rightsConfirmed'
    | 'review'
    | 'pack'
    | 'pipelineId'
    | 'pipelineVersion'
    | 'voiceover'
    | 'subtitles'
  >,
): RunStageKey {
  const pipeline = getRunPipeline(run);
  const hasPreflight = pipeline.stageKeys.includes('preflight');
  const hasVoice = pipeline.stageKeys.includes('voice');
  const hasSubtitles = pipeline.stageKeys.includes('subtitles');
  const hasReview = pipeline.stageKeys.includes('review');
  if (!run.checks.length) return hasPreflight ? 'preflight' : 'assets';
  const blocks = run.checks.filter((check) => check.level === 'block');
  if (hasPreflight && blocks.some((check) => check.category === 'script' || check.category === 'platform')) {
    return 'preflight';
  }
  if (
    blocks.some((check) => check.category === 'assets' || check.category === 'rights') ||
    !run.rightsConfirmed ||
    run.assetSlots.some((slot) => slot.status === 'missing') ||
    (!hasPreflight && blocks.length > 0)
  ) {
    return 'assets';
  }
  if (hasVoice && run.voiceover?.status !== 'ready') return 'voice';
  if (hasSubtitles && run.subtitles?.status !== 'ready') return 'subtitles';
  if (hasReview && !run.review.approved) return 'review';
  return 'pack';
}

export function getRunStages(run: ProductionRun): RunStage[] {
  const pipeline = getRunPipeline(run);
  const hasPreflight = pipeline.stageKeys.includes('preflight');
  const hasVoice = pipeline.stageKeys.includes('voice');
  const hasSubtitles = pipeline.stageKeys.includes('subtitles');
  const hasChecks = run.checks.length > 0;
  const blocks = run.checks.filter((check) => check.level === 'block');
  const preflightBlocked = blocks.some(
    (check) => check.category === 'script' || check.category === 'platform',
  );
  const assetsBlocked =
    blocks.some((check) => check.category === 'assets' || check.category === 'rights') ||
    !run.rightsConfirmed ||
    run.assetSlots.some((slot) => slot.status === 'missing') ||
    (!hasPreflight && blocks.length > 0);
  const assetsDone =
    run.assetSlots.length > 0 &&
    run.assetSlots.every((slot) => slot.status !== 'missing') &&
    run.rightsConfirmed;
  const voiceReady = !hasVoice || run.voiceover?.status === 'ready';
  const subtitlesReady = !hasSubtitles || run.subtitles?.status === 'ready';

  const statuses: Record<RunStageKey, RunStage['status']> = {
    lock: 'done',
    preflight: !hasChecks ? 'active' : preflightBlocked ? 'blocked' : 'done',
    assets: !hasChecks
      ? hasPreflight
        ? 'pending'
        : 'active'
      : assetsBlocked
        ? 'blocked'
        : assetsDone
          ? 'done'
          : 'active',
    voice: !hasVoice
      ? 'pending'
      : !assetsDone
        ? 'pending'
        : run.voiceover?.status === 'failed'
          ? 'blocked'
          : run.voiceover?.status === 'ready'
            ? 'done'
            : 'active',
    subtitles: !hasSubtitles
      ? 'pending'
      : !voiceReady
        ? 'pending'
        : run.subtitles?.status === 'failed'
          ? 'blocked'
          : run.subtitles?.status === 'ready'
            ? 'done'
            : 'active',
    review:
      blocks.length > 0
        ? 'pending'
        : run.review.approved
          ? 'done'
          : assetsDone && voiceReady && subtitlesReady
            ? 'active'
            : 'pending',
    pack:
      run.pack && !run.pack.stale
        ? 'done'
        : deriveRunStatus(run) === 'ready'
          ? 'active'
          : 'pending',
  };

  return pipeline.stageKeys.map((key) => {
    const stage = PRODUCTION_PIPELINE.stages.find((item) => item.key === key);
    return {
      key,
      label: stage?.label ?? key,
      status: statuses[key],
    };
  });
}

function applyRunState(
  run: ProductionRun,
  patch: Partial<ProductionRun>,
  opts: { resetReview?: boolean; markPackStale?: boolean } = {},
): ProductionRun {
  const next: ProductionRun = {
    ...run,
    ...patch,
    updatedAt: now(),
  };
  if (opts.resetReview) {
    next.review = {
      ...next.review,
      approved: false,
      approvedAt: undefined,
    };
  }
  if (opts.markPackStale && next.pack) {
    next.pack = { ...next.pack, stale: true };
  }
  next.status = deriveRunStatus(next);
  next.stage = computeRunStage(next);
  return next;
}

function recomputeLocalChecks(run: ProductionRun): RunCheck[] {
  return buildRunChecks(
    run,
    run.snapshot.platformCheck,
    run.snapshot.platformCheckError,
  );
}

function buildBaseRun(
  script: Script,
  topic: Topic | undefined,
  demo: boolean,
  actor?: string,
  pipelineId?: string,
  pipelineVersion?: string,
): ProductionRun {
  const capturedAt = now();
  const pipeline = getPipeline(pipelineId ?? inferPipeline(script).id, pipelineVersion);
  const base: ProductionRun = {
    id: crypto.randomUUID(),
    title: script.title.trim() || topic?.title.trim() || '未命名成片任务',
    topicId: script.topicId,
    scriptId: script.id,
    platform: script.platform,
    version: script.version,
    pipelineId: pipeline.id,
    pipelineVersion: pipeline.version,
    status: 'draft',
    stage: pipeline.stageKeys.includes('preflight') ? 'preflight' : 'assets',
    createdAt: capturedAt,
    updatedAt: capturedAt,
    snapshot: {
      capturedAt,
      scriptUpdatedAt: script.updatedAt,
      script: snapshotScript(script),
      topic: snapshotTopic(topic),
    },
    checks: [],
    assetSlots: buildAssetSlots(snapshotScript(script)),
    rightsConfirmed: false,
    review: { approved: false, reviewer: '', note: '' },
    demo,
    notes: '',
  };
  base.events = appendRunEvents(
    base,
    [
      {
        type: 'created',
        summary: '创建任务并锁定脚本快照',
        meta: { scriptId: script.id, pipeline: pipeline.id },
      },
    ],
    actor,
  );
  return base;
}

export async function createRun(
  script: Script,
  topic?: Topic,
  actor?: string,
  pipelineId?: string,
): Promise<ProductionRun> {
  const base = buildBaseRun(script, topic, false, actor, pipelineId);
  await db.runs.put(base);
  // 快照创建是本地操作，立即返回；发布前检查由详情页自动触发。
  // 这样平台接口慢/不可用不会阻塞创建，也符合本地创建 <100ms 的口径。
  return base;
}

/**
 * 演示任务：不调用平台接口，明确把平台检查标为「待运行」。
 * 这样 HR 打开时能看到完整任务结构，也不会把演示结果伪装成真实检查。
 */
export async function createDemoRun(script: Script, topic?: Topic): Promise<ProductionRun> {
  // 演示任务固定使用 v1：不需要 TTS worker 也能完整展示门禁与导出。
  const run = buildBaseRun(
    script,
    topic,
    true,
    '演示数据',
    GAME_LONGFORM_PIPELINE.id,
    GAME_LONGFORM_PIPELINE.version,
  );
  run.id = `demo-run-${script.id}`;
  run.checks = buildRunChecks(
    run,
    undefined,
    '演示任务：平台规则检查待运行，点击「重新检查」获取真实结论',
  );
  run.status = deriveRunStatus(run);
  run.stage = computeRunStage(run);
  run.notes = '演示任务：只展示成片任务的结构与门禁，不代表真实生产记录。';
  await db.runs.put(run);
  return run;
}

export async function getRun(id: string): Promise<ProductionRun | undefined> {
  return db.runs.get(id);
}

export async function listRuns(): Promise<ProductionRun[]> {
  return db.runs.orderBy('updatedAt').reverse().toArray();
}

export async function refreshRun(id: string, actor?: string): Promise<ProductionRun> {
  const run = await db.runs.get(id);
  if (!run) throw new Error('成片任务不存在');
  const hydrated = await hydrateRunAssetRights(run);
  const pipeline = getRunPipeline(hydrated);
  const result = pipeline.stageKeys.includes('preflight')
    ? await runPreflight(hydrated)
    : { checks: buildRunChecks(hydrated), platformCheck: undefined, platformCheckError: undefined };
  const block = result.checks.filter((check) => check.level === 'block').length;
  const warn = result.checks.filter((check) => check.level === 'warn').length;
  const pass = result.checks.filter((check) => check.level === 'pass').length;
  const events = appendRunEvents(
    hydrated,
    [
      {
        type: 'checked',
        summary: `${pipeline.stageKeys.includes('preflight') ? '发布前检查' : '素材与发布检查'}：${block} 阻塞 / ${warn} 提醒 / ${pass} 通过`,
        meta: {
          block,
          warn,
          pass,
          ...(result.platformCheckError ? { platformError: result.platformCheckError } : {}),
        },
      },
    ],
    actor,
  );
  const next = applyRunState(
    hydrated,
    {
      checks: result.checks,
      assetSlots: hydrated.assetSlots,
      snapshot: {
        ...hydrated.snapshot,
        platformCheck: result.platformCheck,
        platformCheckError: result.platformCheckError,
      },
      events,
    },
    { resetReview: true, markPackStale: true },
  );
  await db.runs.put(next);
  return next;
}

export async function updateAssetSlot(
  runId: string,
  slotId: string,
  patch: Partial<Pick<AssetSlot, 'kind' | 'status' | 'note'>>,
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  const current = run.assetSlots.find((slot) => slot.id === slotId);
  if (!current) throw new Error('素材槽位不存在');
  const assetSlots = run.assetSlots.map((slot) =>
    slot.id === slotId ? { ...slot, ...patch } : slot,
  );
  const withSlots = { ...run, assetSlots };
  const hydrated = await hydrateRunAssetRights(withSlots);
  const changes: string[] = [];
  if (patch.kind !== undefined && patch.kind !== current.kind) {
    changes.push(`类型改为${ASSET_KIND_LABELS[patch.kind]}`);
  }
  if (patch.status !== undefined && patch.status !== current.status) {
    changes.push(`状态改为${ASSET_STATUS_LABELS[patch.status]}`);
  }
  if (patch.note !== undefined && patch.note !== current.note) {
    changes.push('备注已更新');
  }
  const events = changes.length
    ? appendRunEvents(
        run,
        [
          {
            type: 'asset_updated',
            summary: `镜 ${current.sceneNumber} 素材${changes.join('，')}`,
            meta: {
              sceneNumber: current.sceneNumber,
              fields: Object.keys(patch).join(','),
            },
          },
        ],
        actor,
      )
    : undefined;
  const checks = recomputeLocalChecks(hydrated);
  const next = applyRunState(
    hydrated,
    events ? { checks, events } : { checks },
    { resetReview: true, markPackStale: true },
  );
  await db.runs.put(next);
  return next;
}

export async function assignSlotAsset(
  runId: string,
  slotId: string,
  assetId: string | null,
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  const current = run.assetSlots.find((slot) => slot.id === slotId);
  if (!current) throw new Error('素材槽位不存在');
  let patched: AssetSlot;
  let assetTitle = '';
  if (assetId) {
    const asset = await db.assets.get(assetId);
    if (!asset) throw new Error('素材库记录不存在');
    const snapshot = assetSnapshotFromLibrary(asset);
    assetTitle = asset.title;
    patched = {
      ...current,
      assetId: asset.id,
      assetSnapshot: snapshot,
      matchStatus: 'matched',
      rightsStatus: evaluateAssetRights(snapshot, run.platform),
      kind: slotKindFromAssetType(asset.type),
      status: 'ready',
    };
  } else {
    patched = {
      ...current,
      assetId: undefined,
      assetSnapshot: undefined,
      matchStatus: current.status === 'missing' ? 'missing' : 'unmatched',
      rightsStatus: 'unknown',
    };
  }
  const withAsset = {
    ...run,
    assetSlots: run.assetSlots.map((slot) => (slot.id === slotId ? patched : slot)),
  };
  const hydrated = await hydrateRunAssetRights(withAsset);
  const checks = recomputeLocalChecks(hydrated);
  const events = appendRunEvents(
    run,
    [
      {
        type: 'asset_updated',
        summary: assetId
          ? `镜 ${current.sceneNumber} 关联素材库：${assetTitle}`
          : `镜 ${current.sceneNumber} 取消素材库关联`,
        meta: {
          sceneNumber: current.sceneNumber,
          assetId: assetId ?? null,
          fields: assetId ? 'assetId' : 'assetId,cleared',
        },
      },
    ],
    actor,
  );
  const next = applyRunState(
    hydrated,
    { checks, events },
    { resetReview: true, markPackStale: true },
  );
  await db.runs.put(next);
  return next;
}

/**
 * 导出前刷新素材授权快照与本地检查：
 * 授权到期/素材被修改后，不需要重新跑平台接口也能阻止过期发布包。
 */
export async function syncRunAssetRights(runId: string): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  const hydrated = await hydrateRunAssetRights(run);
  const checks = recomputeLocalChecks(hydrated);
  const checksSignature = (items: RunCheck[]) =>
    JSON.stringify(items.map((check) => ({ ...check, checkedAt: 0 })));
  const checksChanged = checksSignature(checks) !== checksSignature(run.checks);
  const slotsChanged = JSON.stringify(hydrated.assetSlots) !== JSON.stringify(run.assetSlots);
  if (!checksChanged && !slotsChanged) return run;
  const next = applyRunState(
    hydrated,
    { checks },
    { resetReview: checksChanged, markPackStale: true },
  );
  await db.runs.put(next);
  return next;
}

export async function setRightsConfirmed(
  runId: string,
  confirmed: boolean,
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  const withRights = { ...run, rightsConfirmed: confirmed };
  const hydrated = await hydrateRunAssetRights(withRights);
  const checks = recomputeLocalChecks(hydrated);
  const events =
    confirmed !== run.rightsConfirmed
      ? appendRunEvents(
          run,
          [
            {
              type: confirmed ? 'rights_confirmed' : 'rights_revoked',
              summary: confirmed ? '已确认素材版权/授权' : '已取消版权确认',
            },
          ],
          actor,
        )
      : undefined;
  const next = applyRunState(
    hydrated,
    events ? { checks, events } : { checks },
    { resetReview: true, markPackStale: true },
  );
  await db.runs.put(next);
  return next;
}

export async function saveReview(
  runId: string,
  input: { approved: boolean; reviewer: string; note: string },
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  const hydrated = await hydrateRunAssetRights(run);
  const withChecks = { ...hydrated, checks: recomputeLocalChecks(hydrated) };
  const warnings = withChecks.checks.filter((check) => check.level === 'warn');
  if (input.approved) {
    const blocks = withChecks.checks.filter((check) => check.level === 'block');
    if (blocks.length) {
      throw new Error(`还有 ${blocks.length} 个阻塞项，不能标记复核通过`);
    }
    if (warnings.length && !input.note.trim()) {
      throw new Error('存在提醒项，请填写复核备注');
    }
  }
  const review: RunReview = {
    approved: input.approved,
    reviewer: input.reviewer.trim() || '本地复核',
    note: input.note.trim(),
    ...(input.approved ? { approvedAt: now() } : {}),
  };
  const events = appendRunEvents(
    withChecks,
    [
      input.approved
        ? {
            type: 'review_approved',
            summary: '复核通过',
            meta: { reviewer: review.reviewer, warnings: warnings.length },
          }
        : {
            type: 'review_revoked',
            summary: '撤销复核',
            meta: { reviewer: review.reviewer },
          },
    ],
    actor,
  );
  const next = applyRunState(
    withChecks,
    { review, events },
    { markPackStale: true },
  );
  await db.runs.put(next);
  return next;
}

export async function saveRunNotes(
  runId: string,
  notes: string,
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  if (notes === run.notes) return run;
  const events = appendRunEvents(run, [{ type: 'note_updated', summary: '更新任务备注' }], actor);
  const next = applyRunState(run, { notes, events });
  await db.runs.put(next);
  return next;
}

export async function recordRunPack(
  runId: string,
  record: Omit<RunPackRecord, 'mode'>,
  mode: 'publish' | 'draft',
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  if (
    mode === 'publish' &&
    deriveRunStatus(run) !== 'ready' &&
    !(run.status === 'exported' && !run.pack?.stale)
  ) {
    throw new Error('当前任务还不能导出发布包');
  }
  const packRecord: RunPackRecord = { ...record, mode };
  const events = appendRunEvents(
    run,
    [
      {
        type: 'pack_exported',
        summary: mode === 'publish' ? '导出发布包' : '导出草稿包',
        meta: { mode, fileName: record.fileName, fileCount: record.fileCount },
      },
    ],
    actor,
  );
  const next = applyRunState(
    run,
    mode === 'publish' ? { pack: packRecord, events } : { draftPack: packRecord, events },
  );
  if (mode === 'publish' && packRecord.stale) {
    next.status = 'ready';
  }
  await db.runs.put(next);
  return next;
}

export async function archiveRun(runId: string, actor?: string): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  if (run.status === 'archived') return run;
  const events = appendRunEvents(run, [{ type: 'archived', summary: '归档任务' }], actor);
  const next = {
    ...run,
    events,
    status: 'archived' as const,
    updatedAt: now(),
  };
  await db.runs.put(next);
  return next;
}

export interface RunPublishInput {
  topicId: string;
  platform: Platform;
  bvid?: string;
  url?: string;
  title?: string;
  publishedAt: number;
}

/**
 * 是否指向同一条发布记录：优先 bvid；没有 bvid 时退回 platform + publishedAt + title。
 * 只做精确匹配，不做模糊猜测。
 */
export function publishRefMatches(
  ref: RunPublishRef | undefined,
  input: RunPublishInput,
): boolean {
  if (!ref) return false;
  if (ref.topicId !== input.topicId || ref.platform !== input.platform) return false;
  if (input.bvid) return (ref.bvid ?? '').toLowerCase() === input.bvid.toLowerCase();
  return ref.publishedAt === input.publishedAt && (ref.title ?? '') === (input.title ?? '');
}

/** 同一选题、同一平台、同一条发布记录是否已绑定在别的任务上。 */
export async function findRunPublishConflict(
  runId: string,
  input: RunPublishInput,
): Promise<ProductionRun | undefined> {
  const runs = await db.runs.toArray();
  return runs.find(
    (run) =>
      run.id !== runId &&
      run.topicId === input.topicId &&
      publishRefMatches(run.publishRef, input),
  );
}

export async function bindRunPublish(
  runId: string,
  input: RunPublishInput,
  options: { actor?: string; force?: boolean } = {},
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  if (input.topicId !== run.topicId) {
    throw new Error('发布记录与当前任务不是同一个选题，不能绑定');
  }
  if (input.platform !== run.platform) {
    throw new Error(
      `发布记录属于${PLATFORM_LABELS[input.platform]}，当前任务是${PLATFORM_LABELS[run.platform]}，不能绑定`,
    );
  }
  if (!Number.isFinite(input.publishedAt)) {
    throw new Error('发布记录缺少发布时间，不能绑定');
  }
  const conflict = await findRunPublishConflict(runId, input);
  if (conflict && !options.force) {
    throw new Error(`该发布记录已绑定到另一条任务「${conflict.title}」`);
  }
  const publishRef: RunPublishRef = {
    topicId: input.topicId,
    platform: input.platform,
    ...(input.bvid ? { bvid: input.bvid } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.title ? { title: input.title } : {}),
    publishedAt: input.publishedAt,
    boundAt: now(),
  };
  const events = appendRunEvents(
    run,
    [
      {
        type: 'publish_bound',
        summary: '绑定发布记录',
        meta: {
          platform: input.platform,
          bvid: input.bvid ?? null,
          topicId: input.topicId,
        },
      },
    ],
    options.actor,
  );
  const next = applyRunState(run, { publishRef, events });
  await db.runs.put(next);
  return next;
}

export async function unbindRunPublish(runId: string, actor?: string): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  if (!run.publishRef) return run;
  const { platform, bvid } = run.publishRef;
  const events = appendRunEvents(
    run,
    [
      {
        type: 'publish_unbound',
        summary: '解绑发布记录',
        meta: { platform, bvid: bvid ?? null },
      },
    ],
    actor,
  );
  const next = applyRunState(run, { publishRef: undefined, events });
  await db.runs.put(next);
  return next;
}

export interface CreateVariantResult {
  run: ProductionRun;
  original: ProductionRun;
}

/**
 * 从一条 run 创建同选题、另一平台的同组任务。
 * 两条 run 的检查/素材/复核互不影响，只共享 campaignId 与选题。
 */
export async function createVariantRun(
  runId: string,
  scriptId: string,
  actor?: string,
): Promise<CreateVariantResult> {
  const original = await db.runs.get(runId);
  if (!original) throw new Error('成片任务不存在');
  const script = await db.scripts.get(scriptId);
  if (!script) throw new Error('脚本不存在');
  if (script.topicId !== original.topicId) {
    throw new Error('只能选择同一选题下的脚本版本');
  }
  if (script.platform === original.platform) {
    throw new Error('请选择另一平台的脚本版本');
  }
  const topic = await db.topics.get(script.topicId);
  const variant = buildBaseRun(script, topic, false, actor);
  const campaignId = original.campaignId ?? crypto.randomUUID();
  variant.campaignId = campaignId;
  variant.variantOfRunId = original.id;

  let updatedOriginal = original;
  await db.transaction('rw', db.runs, async () => {
    if (!original.campaignId) {
      updatedOriginal = applyRunState(original, { campaignId });
      await db.runs.put(updatedOriginal);
    }
    await db.runs.put(variant);
  });
  return { run: variant, original: updatedOriginal };
}

export async function listCampaignRuns(campaignId: string): Promise<ProductionRun[]> {
  const runs = await db.runs.toArray();
  return runs
    .filter((run) => run.campaignId === campaignId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** 组合包导出只追加事件，不改每条任务的 pack 记录/状态。 */
export async function recordCampaignPack(
  runIds: string[],
  record: { fileName: string; fileCount: number },
  actor?: string,
): Promise<ProductionRun[]> {
  const runs = (await db.runs.bulkGet(runIds)).filter(
    (run): run is ProductionRun => !!run,
  );
  if (!runs.length) return [];
  const updated = runs.map((run) => ({
    ...run,
    events: appendRunEvents(
      run,
      [
        {
          type: 'pack_exported',
          summary: '导出组合包',
          meta: { mode: 'campaign', fileName: record.fileName, fileCount: record.fileCount },
        },
      ],
      actor,
    ),
    updatedAt: now(),
  }));
  await db.runs.bulkPut(updated);
  return updated;
}

export interface RecordVoiceoverInput {
  blob: Blob;
  durationSec: number;
  provider: string;
  voice: string;
  rate: string;
  pitch: string;
  charCount: number;
  boundaries: RunVoiceBoundary[];
  subtitles: RunSubtitles;
}

/** 保存配音音频（本机 Blob）与字幕；写入后立即按新工件重算门禁。 */
export async function recordRunVoiceover(
  runId: string,
  input: RecordVoiceoverInput,
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  const generatedAt = now();
  const mediaId = crypto.randomUUID();
  const voiceSettings: RunVoiceSettings = {
    voice: input.voice,
    rate: input.rate,
    pitch: input.pitch,
  };
  const voiceover = {
    status: 'ready' as const,
    provider: input.provider,
    voice: input.voice,
    rate: input.rate,
    pitch: input.pitch,
    mediaId,
    fileName: 'voiceover.mp3',
    mime: input.blob.type || 'audio/mpeg',
    size: input.blob.size,
    durationSec: input.durationSec,
    generatedAt,
    boundaries: input.boundaries,
  };
  const subtitles: RunSubtitles = { ...input.subtitles, generatedAt };
  const withArtifacts: ProductionRun = {
    ...run,
    voiceover,
    subtitles,
    voiceSettings,
  };
  const checks = recomputeLocalChecks(withArtifacts);
  const events = appendRunEvents(
    run,
    [
      {
        type: 'voice_generated',
        summary: `生成配音：${input.voice} · ${input.durationSec.toFixed(1)} 秒`,
        meta: { provider: input.provider, voice: input.voice, durationSec: input.durationSec },
      },
      {
        type: 'subtitles_generated',
        summary: `生成字幕：${subtitles.cueCount ?? 0} 条`,
        meta: { preset: subtitles.preset, cueCount: subtitles.cueCount ?? 0 },
      },
    ],
    actor,
  );
  const next = applyRunState(
    withArtifacts,
    { checks, events },
    { resetReview: true, markPackStale: true },
  );
  const mediaRecord: RunMediaRecord = {
    id: mediaId,
    runId,
    kind: 'voiceover',
    fileName: 'voiceover.mp3',
    mime: input.blob.type || 'audio/mpeg',
    size: input.blob.size,
    durationSec: input.durationSec,
    blob: input.blob,
    createdAt: generatedAt,
  };
  await db.transaction('rw', [db.runs, db.runMedia], async () => {
    await db.runMedia.where('runId').equals(runId).delete();
    await db.runMedia.put(mediaRecord);
    await db.runs.put(next);
  });
  // 本地 Edge TTS 免费，但仍然记一条可核对成本记录（0 元 + 字符数）。
  await recordRunCost({
    runId,
    providerId: 'edge-tts',
    capability: 'tts',
    operation: 'voiceover',
    units: input.charCount,
    unitLabel: '字符',
    estimatedCost: 0,
    actualCost: 0,
    source: 'local',
    note: '本地 Edge TTS，免费；实际账单以供应商为准。',
  });
  return next;
}

/**
 * 记录一次 TTS 失败。没有旧配音时把阶段置为 failed 以便解释；
 * 已有可用配音时保留旧音频/字幕，只追加失败事件，避免重试失败把成品清空。
 */
export async function recordRunVoiceFailure(
  runId: string,
  error: string,
  settings: RunVoiceSettings,
  actor?: string,
): Promise<ProductionRun> {
  const run = await db.runs.get(runId);
  if (!run) throw new Error('成片任务不存在');
  const hasReadyVoice = run.voiceover?.status === 'ready';
  const withState: ProductionRun = hasReadyVoice
    ? { ...run, voiceSettings: settings }
    : {
        ...run,
        voiceSettings: settings,
        voiceover: {
          status: 'failed',
          provider: 'edge-tts',
          voice: settings.voice,
          rate: settings.rate,
          pitch: settings.pitch,
          error: error.slice(0, 500),
        },
        subtitles: undefined,
      };
  const checks = recomputeLocalChecks(withState);
  const events = appendRunEvents(
    run,
    [
      {
        type: 'voice_failed',
        summary: '配音生成失败',
        meta: { error: error.slice(0, 300) },
      },
    ],
    actor,
  );
  const next = applyRunState(
    withState,
    { checks, events },
    { resetReview: true, markPackStale: true },
  );
  await db.runs.put(next);
  return next;
}

export async function deleteRun(runId: string): Promise<void> {
  await deleteRunMedia(runId);
  await deleteRunCosts(runId);
  await db.runs.delete(runId);
}

export function scriptIsNewer(run: ProductionRun, script?: Script): boolean {
  return !!script && script.updatedAt > run.snapshot.scriptUpdatedAt;
}

export function summarizeAssetProgress(slots: AssetSlot[]): {
  total: number;
  ready: number;
  missing: number;
  skipped: number;
} {
  return {
    total: slots.length,
    ready: slots.filter((slot) => slot.status === 'ready').length,
    missing: slots.filter((slot) => slot.status === 'missing').length,
    skipped: slots.filter((slot) => slot.status === 'not_needed').length,
  };
}

// 这些类型只用于 UI 侧的局部变量，集中导出可减少页面重复 import。
export type { AssetSlotKind, AssetSlotStatus };
