import { db } from '../db';
import type { CostCapability, RunCostEntry } from '../types';

export interface RecordRunCostInput {
  runId: string;
  providerId: string;
  capability: CostCapability;
  operation: string;
  units: number;
  unitLabel: string;
  estimatedCost: number | null;
  actualCost: number | null;
  source: 'local' | 'api' | 'manual';
  note?: string;
  batchId?: string;
}

export interface CostSummary {
  entries: number;
  totalEstimated: number;
  totalActual: number;
  unknownEstimated: number;
  unknownActual: number;
  byProvider: Record<string, { entries: number; estimated: number; actual: number }>;
}

export async function recordRunCost(input: RecordRunCostInput): Promise<RunCostEntry> {
  const entry: RunCostEntry = {
    id: crypto.randomUUID(),
    runId: input.runId,
    providerId: input.providerId,
    capability: input.capability,
    operation: input.operation,
    units: input.units,
    unitLabel: input.unitLabel,
    estimatedCost: input.estimatedCost,
    actualCost: input.actualCost,
    currency: 'CNY',
    source: input.source,
    at: Date.now(),
    ...(input.note ? { note: input.note } : {}),
    ...(input.batchId ? { batchId: input.batchId } : {}),
  };
  await db.runCosts.put(entry);
  return entry;
}

export async function listRunCosts(runId: string): Promise<RunCostEntry[]> {
  return db.runCosts.where('runId').equals(runId).toArray();
}

export async function listRunCostsForRuns(runIds: string[]): Promise<RunCostEntry[]> {
  if (!runIds.length) return [];
  const entries = await db.runCosts.where('runId').anyOf(runIds).toArray();
  return entries;
}

export async function deleteRunCosts(runId: string): Promise<void> {
  await db.runCosts.where('runId').equals(runId).delete();
}

export function summarizeCosts(entries: RunCostEntry[]): CostSummary {
  const summary: CostSummary = {
    entries: entries.length,
    totalEstimated: 0,
    totalActual: 0,
    unknownEstimated: 0,
    unknownActual: 0,
    byProvider: {},
  };
  for (const entry of entries) {
    const provider = summary.byProvider[entry.providerId] ?? { entries: 0, estimated: 0, actual: 0 };
    provider.entries += 1;
    if (entry.estimatedCost === null) summary.unknownEstimated += 1;
    else {
      summary.totalEstimated += entry.estimatedCost;
      provider.estimated += entry.estimatedCost;
    }
    if (entry.actualCost === null) summary.unknownActual += 1;
    else {
      summary.totalActual += entry.actualCost;
      provider.actual += entry.actualCost;
    }
    summary.byProvider[entry.providerId] = provider;
  }
  return summary;
}

export function formatCost(value: number | null): string {
  if (value === null) return '未记录';
  return `¥${value.toFixed(2)}`;
}
