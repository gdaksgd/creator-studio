import { db } from '../db';
import { MAX_RUN_EVENTS } from './runService';
import type { BriefAttachment, CampaignPlanItem, ContentExperiment, GameMarketingBrief, LibraryAsset, MaterialFavorite, ProductionRun, RunBatch, RunBatchItem, RunCostEntry, Script, Storyboard, Topic } from '../types';

const BACKUP_FORMAT = 'creator-studio-local-backup';
const BACKUP_VERSION = 4;
const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
const MAX_RECORDS = 50_000;
const TOPIC_STATUSES = new Set(['idea', 'researching', 'approved', 'scripting', 'done', 'published']);
const PLATFORMS = new Set(['bilibili', 'douyin']);

export interface LocalBackup {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: number;
  appVersion: string;
  topics: Topic[];
  scripts: Script[];
  assets: LibraryAsset[];
  materialFavorites: MaterialFavorite[];
  briefAttachments: BriefAttachment[];
  marketingWorkbench: { experiments: ContentExperiment[]; briefs: GameMarketingBrief[] };
  runs: ProductionRun[];
  runCosts: RunCostEntry[];
  runBatches: RunBatch[];
}

export interface BackupPreview {
  backup: LocalBackup;
  exportedAt: number;
  topicCount: number;
  scriptCount: number;
  assetCount: number;
  experimentCount: number;
  briefCount: number;
  favoriteCount: number;
  attachmentCount: number;
  storyboardCount: number;
  runCount: number;
  costCount: number;
  batchCount: number;
  demoCount: number;
  orphanScriptCount: number;
  duplicateTopicIds: number;
  duplicateScriptIds: number;
  warnings: string[];
}

export interface BackupRestoreResult {
  topicCount: number;
  scriptCount: number;
  assetCount: number;
  experimentCount: number;
  briefCount: number;
  favoriteCount: number;
  attachmentCount: number;
  runCount: number;
  costCount: number;
  batchCount: number;
  mode: 'replace' | 'merge';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string, path: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`${path}.${key} 必须是文本`);
  return value;
}

function requireFiniteNumber(row: Record<string, unknown>, key: string, path: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path}.${key} 必须是有效数字`);
  return value;
}

function validateTopic(value: unknown, index: number): Topic {
  const path = `topics[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  const id = requireString(value, 'id', path);
  const title = requireString(value, 'title', path);
  const category = requireString(value, 'category', path);
  const status = requireString(value, 'status', path);
  if (!id.trim() || !title.trim() || !category.trim()) throw new Error(`${path} 缺少 ID、标题或品类`);
  if (!TOPIC_STATUSES.has(status)) throw new Error(`${path}.status 不受支持`);
  if (!['low', 'medium', 'high'].includes(String(value.urgency))) throw new Error(`${path}.urgency 不受支持`);
  const difficulty = requireFiniteNumber(value, 'difficulty', path);
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) throw new Error(`${path}.difficulty 必须是 1–5 的整数`);
  requireFiniteNumber(value, 'createdAt', path);
  requireFiniteNumber(value, 'updatedAt', path);
  requireFiniteNumber(value, 'estimatedViews', path);
  for (const key of ['notes', 'productionIdea', 'gameDescription']) requireString(value, key, path);
  return value as unknown as Topic;
}

function validateStoryboard(value: unknown, path: string): Storyboard {
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  requireString(value, 'id', path);
  for (const key of ['description', 'dialogue', 'notes', 'visualDirection']) requireString(value, key, path);
  const sceneNumber = requireFiniteNumber(value, 'sceneNumber', path);
  const duration = requireFiniteNumber(value, 'duration', path);
  if (!Number.isInteger(sceneNumber) || sceneNumber < 1) throw new Error(`${path}.sceneNumber 必须是正整数`);
  if (duration < 0) throw new Error(`${path}.duration 不能小于 0`);
  return value as unknown as Storyboard;
}

function validateScript(value: unknown, index: number): Script {
  const path = `scripts[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  const id = requireString(value, 'id', path);
  const topicId = requireString(value, 'topicId', path);
  if (!id.trim() || !topicId.trim()) throw new Error(`${path} 缺少 ID 或关联选题 ID`);
  if (!PLATFORMS.has(String(value.platform))) throw new Error(`${path}.platform 不受支持`);
  if (!['long', 'short'].includes(String(value.version))) throw new Error(`${path}.version 不受支持`);
  for (const key of ['title', 'hook', 'notes']) requireString(value, key, path);
  requireFiniteNumber(value, 'createdAt', path);
  requireFiniteNumber(value, 'updatedAt', path);
  if (!Array.isArray(value.storyboards)) throw new Error(`${path}.storyboards 必须是数组`);
  return { ...value, storyboards: value.storyboards.map((board, boardIndex) => validateStoryboard(board, `${path}.storyboards[${boardIndex}]`)) } as unknown as Script;
}

// ── 成片任务校验（备份 v3+；v4 增加成本/批量） ─────────────────

const RUN_STATUSES = new Set(['draft', 'blocked', 'review', 'ready', 'exported', 'archived']);
const RUN_STAGES = new Set(['lock', 'preflight', 'assets', 'review', 'pack']);
const RUN_CHECK_LEVELS = new Set(['block', 'warn', 'pass', 'info']);
const RUN_CHECK_CATEGORIES = new Set(['script', 'platform', 'evidence', 'assets', 'rights', 'pipeline', 'voice', 'subtitles']);
const SUBTITLE_PRESETS = new Set(['bilibili', 'douyin']);
const COST_CAPABILITIES = new Set(['llm', 'tts', 'image', 'video', 'stock', 'platform', 'data', 'manual']);
const COST_SOURCES = new Set(['local', 'api', 'manual']);
const BATCH_STATUSES = new Set(['draft', 'running', 'completed', 'partial', 'failed']);
const BATCH_ITEM_STATUSES = new Set(['pending', 'running', 'done', 'failed']);
const RUN_CHECK_SOURCES = new Set(['local', 'platform', 'topic']);
const ASSET_KINDS = new Set(['video', 'image', 'graphic', 'audio', 'other', 'unspecified']);
const ASSET_STATUSES = new Set(['missing', 'ready', 'not_needed']);
const ASSET_SOURCE_TYPES = new Set(['local', 'stock', 'ai', 'original']);
const ASSET_LICENSES = new Set(['own', 'licensed', 'cc', 'unknown']);
const ASSET_MATCH_STATUSES = new Set(['unmatched', 'suggested', 'matched', 'missing']);
const ASSET_RIGHTS_STATUSES = new Set(['ok', 'unknown', 'expired', 'platform_blocked']);
const RUN_EVENT_TYPES = new Set([
  'created', 'checked', 'asset_updated', 'rights_confirmed', 'rights_revoked',
  'review_approved', 'review_revoked', 'pack_exported', 'archived', 'note_updated',
  'publish_bound', 'publish_unbound', 'voice_generated', 'voice_failed',
  'subtitles_generated', 'subtitles_failed',
]);

function validateRunEvent(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['id', 'type', 'actor', 'summary']) requireString(value, key, path);
  if (!RUN_EVENT_TYPES.has(String(value.type))) throw new Error(`${path}.type 不受支持`);
  requireFiniteNumber(value, 'at', path);
  if (value.meta !== undefined) {
    if (!isRecord(value.meta)) throw new Error(`${path}.meta 格式无效`);
    for (const [key, metaValue] of Object.entries(value.meta)) {
      if (metaValue === null) continue;
      if (!['string', 'number', 'boolean'].includes(typeof metaValue)) {
        throw new Error(`${path}.meta.${key} 必须是文本、数字、布尔值或 null`);
      }
      if (typeof metaValue === 'number' && !Number.isFinite(metaValue)) {
        throw new Error(`${path}.meta.${key} 必须是有效数字`);
      }
    }
  }
}

function validatePublishRef(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  requireString(value, 'topicId', path);
  if (!PLATFORMS.has(String(value.platform))) throw new Error(`${path}.platform 不受支持`);
  requireFiniteNumber(value, 'publishedAt', path);
  requireFiniteNumber(value, 'boundAt', path);
  for (const key of ['bvid', 'url', 'title']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${path}.${key} 必须是文本`);
    }
  }
}

function validateAssetRightsFields(row: Record<string, unknown>, path: string): void {
  if (row.sourceType !== undefined && !ASSET_SOURCE_TYPES.has(String(row.sourceType))) {
    throw new Error(`${path}.sourceType 不受支持`);
  }
  if (row.license !== undefined && !ASSET_LICENSES.has(String(row.license))) {
    throw new Error(`${path}.license 不受支持`);
  }
  if (row.licenseUrl !== undefined && typeof row.licenseUrl !== 'string') {
    throw new Error(`${path}.licenseUrl 必须是文本`);
  }
  if (row.expiresAt !== undefined) requireFiniteNumber(row, 'expiresAt', path);
  if (row.checksum !== undefined && typeof row.checksum !== 'string') {
    throw new Error(`${path}.checksum 必须是文本`);
  }
  if (row.allowedPlatforms !== undefined) {
    if (!Array.isArray(row.allowedPlatforms)) throw new Error(`${path}.allowedPlatforms 必须是数组`);
    for (const [index, platform] of row.allowedPlatforms.entries()) {
      if (!PLATFORMS.has(String(platform))) {
        throw new Error(`${path}.allowedPlatforms[${index}] 不受支持`);
      }
    }
  }
  if (row.usageCount !== undefined) {
    const usageCount = requireFiniteNumber(row, 'usageCount', path);
    if (!Number.isInteger(usageCount) || usageCount < 0) {
      throw new Error(`${path}.usageCount 必须是非负整数`);
    }
  }
}

function validateAssetSnapshot(value: unknown, path: string): void {
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['id', 'title', 'url']) requireString(value, key, path);
  validateAssetRightsFields(value, path);
}

function validateVoiceSettings(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['voice', 'rate', 'pitch']) requireString(value, key, path);
}

function validateVoiceover(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  if (value.status !== 'ready' && value.status !== 'failed') {
    throw new Error(`${path}.status 不受支持`);
  }
  for (const key of ['provider', 'voice', 'rate', 'pitch']) requireString(value, key, path);
  for (const key of ['mediaId', 'fileName', 'mime', 'error']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${path}.${key} 必须是文本`);
    }
  }
  for (const key of ['size', 'durationSec', 'generatedAt']) {
    if (value[key] !== undefined) requireFiniteNumber(value, key, path);
  }
  if (value.boundaries !== undefined) {
    if (!Array.isArray(value.boundaries)) throw new Error(`${path}.boundaries 必须是数组`);
    value.boundaries.forEach((boundary, index) => {
      const boundaryPath = `${path}.boundaries[${index}]`;
      if (!isRecord(boundary)) throw new Error(`${boundaryPath} 格式无效`);
      requireFiniteNumber(boundary, 'startMs', boundaryPath);
      requireFiniteNumber(boundary, 'endMs', boundaryPath);
      requireString(boundary, 'text', boundaryPath);
    });
  }
}

function validateSubtitles(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  if (value.status !== 'ready' && value.status !== 'failed') {
    throw new Error(`${path}.status 不受支持`);
  }
  if (!SUBTITLE_PRESETS.has(String(value.preset))) throw new Error(`${path}.preset 不受支持`);
  if (value.format !== 'srt') throw new Error(`${path}.format 不受支持`);
  for (const key of ['fileName', 'content', 'error']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${path}.${key} 必须是文本`);
    }
  }
  for (const key of ['cueCount', 'charCount', 'maxLineChars', 'maxCharsPerSecond', 'generatedAt']) {
    if (value[key] !== undefined) requireFiniteNumber(value, key, path);
  }
  if (
    value.timingSource !== undefined &&
    value.timingSource !== 'tts-sentence' &&
    value.timingSource !== 'estimated'
  ) {
    throw new Error(`${path}.timingSource 不受支持`);
  }
  if (value.cues !== undefined) {
    if (!Array.isArray(value.cues)) throw new Error(`${path}.cues 必须是数组`);
    value.cues.forEach((cue, index) => {
      const cuePath = `${path}.cues[${index}]`;
      if (!isRecord(cue)) throw new Error(`${cuePath} 格式无效`);
      requireFiniteNumber(cue, 'index', cuePath);
      requireFiniteNumber(cue, 'startMs', cuePath);
      requireFiniteNumber(cue, 'endMs', cuePath);
      requireString(cue, 'text', cuePath);
    });
  }
}

function validateOptionalCost(value: unknown, path: string): void {
  if (value === null || value === undefined) return;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${path} 必须是有效数字或 null`);
  }
  if (value < 0) throw new Error(`${path} 不能小于 0`);
}

function validateRunCost(value: unknown, index: number): RunCostEntry {
  const path = `runCosts[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['id', 'runId', 'providerId', 'operation', 'unitLabel']) {
    requireString(value, key, path);
  }
  if (!COST_CAPABILITIES.has(String(value.capability))) throw new Error(`${path}.capability 不受支持`);
  if (value.currency !== 'CNY') throw new Error(`${path}.currency 不受支持`);
  if (!COST_SOURCES.has(String(value.source))) throw new Error(`${path}.source 不受支持`);
  const units = requireFiniteNumber(value, 'units', path);
  if (units < 0) throw new Error(`${path}.units 不能小于 0`);
  validateOptionalCost(value.estimatedCost, `${path}.estimatedCost`);
  validateOptionalCost(value.actualCost, `${path}.actualCost`);
  requireFiniteNumber(value, 'at', path);
  for (const key of ['note', 'batchId']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${path}.${key} 必须是文本`);
    }
  }
  return value as unknown as RunCostEntry;
}

function validateBatchItem(value: unknown, path: string): RunBatchItem {
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['runId', 'scriptId', 'runTitle']) requireString(value, key, path);
  if (!PLATFORMS.has(String(value.platform))) throw new Error(`${path}.platform 不受支持`);
  if (!['long', 'short'].includes(String(value.version))) throw new Error(`${path}.version 不受支持`);
  if (!BATCH_ITEM_STATUSES.has(String(value.status))) throw new Error(`${path}.status 不受支持`);
  const attempts = requireFiniteNumber(value, 'attempts', path);
  if (!Number.isInteger(attempts) || attempts < 0) throw new Error(`${path}.attempts 必须是非负整数`);
  if (value.error !== undefined && typeof value.error !== 'string') throw new Error(`${path}.error 必须是文本`);
  if (value.updatedAt !== undefined) requireFiniteNumber(value, 'updatedAt', path);
  return value as unknown as RunBatchItem;
}

function validateRunBatch(value: unknown, index: number): RunBatch {
  const path = `runBatches[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['id', 'title']) requireString(value, key, path);
  if (!BATCH_STATUSES.has(String(value.status))) throw new Error(`${path}.status 不受支持`);
  const concurrency = requireFiniteNumber(value, 'concurrency', path);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error(`${path}.concurrency 必须是 1–10 的整数`);
  }
  requireFiniteNumber(value, 'createdAt', path);
  requireFiniteNumber(value, 'updatedAt', path);
  for (const key of ['actor', 'note']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${path}.${key} 必须是文本`);
    }
  }
  if (!Array.isArray(value.items)) throw new Error(`${path}.items 必须是数组`);
  return {
    ...value,
    items: value.items.map((item, itemIndex) => validateBatchItem(item, `${path}.items[${itemIndex}]`)),
  } as unknown as RunBatch;
}

function validatePack(value: unknown, path: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  requireFiniteNumber(value, 'exportedAt', path);
  requireString(value, 'fileName', path);
  const fileCount = requireFiniteNumber(value, 'fileCount', path);
  if (!Number.isInteger(fileCount) || fileCount < 0) throw new Error(`${path}.fileCount 必须是正整数`);
  if (value.mode !== 'publish' && value.mode !== 'draft') throw new Error(`${path}.mode 不受支持`);
  if (value.stale !== undefined && typeof value.stale !== 'boolean') throw new Error(`${path}.stale 必须是布尔值`);
}

function validateRun(value: unknown, index: number): ProductionRun {
  const path = `runs[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['id', 'title', 'topicId', 'scriptId']) requireString(value, key, path);
  if (!PLATFORMS.has(String(value.platform))) throw new Error(`${path}.platform 不受支持`);
  if (!['long', 'short'].includes(String(value.version))) throw new Error(`${path}.version 不受支持`);
  for (const key of ['pipelineId', 'pipelineVersion', 'campaignId', 'variantOfRunId']) {
    if (value[key] !== undefined && typeof value[key] !== 'string') {
      throw new Error(`${path}.${key} 必须是文本`);
    }
  }
  if (!RUN_STATUSES.has(String(value.status))) throw new Error(`${path}.status 不受支持`);
  if (!RUN_STAGES.has(String(value.stage))) throw new Error(`${path}.stage 不受支持`);
  requireFiniteNumber(value, 'createdAt', path);
  requireFiniteNumber(value, 'updatedAt', path);
  if (typeof value.rightsConfirmed !== 'boolean') throw new Error(`${path}.rightsConfirmed 必须是布尔值`);
  requireString(value, 'notes', path);
  if (value.demo !== undefined && typeof value.demo !== 'boolean') throw new Error(`${path}.demo 必须是布尔值`);

  const snapshot = value.snapshot;
  if (!isRecord(snapshot)) throw new Error(`${path}.snapshot 格式无效`);
  requireFiniteNumber(snapshot, 'capturedAt', `${path}.snapshot`);
  requireFiniteNumber(snapshot, 'scriptUpdatedAt', `${path}.snapshot`);
  try {
    validateScript(snapshot.script, 0);
  } catch (error) {
    throw new Error(`${path}.snapshot.script：${(error as Error).message}`);
  }
  if (snapshot.topic !== undefined && snapshot.topic !== null) {
    if (!isRecord(snapshot.topic)) throw new Error(`${path}.snapshot.topic 格式无效`);
    requireString(snapshot.topic, 'id', `${path}.snapshot.topic`);
    requireString(snapshot.topic, 'title', `${path}.snapshot.topic`);
    if (snapshot.topic.evaluation !== undefined) {
      if (!isRecord(snapshot.topic.evaluation)) throw new Error(`${path}.snapshot.topic.evaluation 格式无效`);
      if (snapshot.topic.evaluation.basis !== undefined && !isRecord(snapshot.topic.evaluation.basis)) {
        throw new Error(`${path}.snapshot.topic.evaluation.basis 格式无效`);
      }
    }
  }
  if (snapshot.platformCheckError !== undefined && typeof snapshot.platformCheckError !== 'string') {
    throw new Error(`${path}.snapshot.platformCheckError 必须是文本`);
  }
  if (snapshot.platformCheck !== undefined && snapshot.platformCheck !== null) {
    if (!isRecord(snapshot.platformCheck)) throw new Error(`${path}.snapshot.platformCheck 格式无效`);
    if (!Array.isArray(snapshot.platformCheck.rules)) throw new Error(`${path}.snapshot.platformCheck.rules 必须是数组`);
    if (!isRecord(snapshot.platformCheck.durationAdvice)) throw new Error(`${path}.snapshot.platformCheck.durationAdvice 格式无效`);
  }

  if (!Array.isArray(value.checks)) throw new Error(`${path}.checks 必须是数组`);
  value.checks.forEach((check, checkIndex) => {
    const checkPath = `${path}.checks[${checkIndex}]`;
    if (!isRecord(check)) throw new Error(`${checkPath} 格式无效`);
    for (const key of ['id', 'label', 'detail']) requireString(check, key, checkPath);
    if (!RUN_CHECK_CATEGORIES.has(String(check.category))) throw new Error(`${checkPath}.category 不受支持`);
    if (!RUN_CHECK_LEVELS.has(String(check.level))) throw new Error(`${checkPath}.level 不受支持`);
    if (!RUN_CHECK_SOURCES.has(String(check.source))) throw new Error(`${checkPath}.source 不受支持`);
    requireFiniteNumber(check, 'checkedAt', checkPath);
    if (check.hint !== undefined && typeof check.hint !== 'string') throw new Error(`${checkPath}.hint 必须是文本`);
    if (check.evidence !== undefined) {
      if (!isRecord(check.evidence)) throw new Error(`${checkPath}.evidence 格式无效`);
      requireString(check.evidence, 'source', `${checkPath}.evidence`);
      if (!['A', 'B', 'C'].includes(String(check.evidence.level))) throw new Error(`${checkPath}.evidence.level 不受支持`);
    }
  });

  if (!Array.isArray(value.assetSlots)) throw new Error(`${path}.assetSlots 必须是数组`);
  value.assetSlots.forEach((slot, slotIndex) => {
    const slotPath = `${path}.assetSlots[${slotIndex}]`;
    if (!isRecord(slot)) throw new Error(`${slotPath} 格式无效`);
    for (const key of ['id', 'storyboardId', 'description', 'visualDirection', 'note']) requireString(slot, key, slotPath);
    const sceneNumber = requireFiniteNumber(slot, 'sceneNumber', slotPath);
    const duration = requireFiniteNumber(slot, 'duration', slotPath);
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) throw new Error(`${slotPath}.sceneNumber 必须是正整数`);
    if (duration < 0) throw new Error(`${slotPath}.duration 不能小于 0`);
    if (!ASSET_KINDS.has(String(slot.kind))) throw new Error(`${slotPath}.kind 不受支持`);
    if (!ASSET_STATUSES.has(String(slot.status))) throw new Error(`${slotPath}.status 不受支持`);
    if (slot.assetId !== undefined && typeof slot.assetId !== 'string') {
      throw new Error(`${slotPath}.assetId 必须是文本`);
    }
    if (slot.matchStatus !== undefined && !ASSET_MATCH_STATUSES.has(String(slot.matchStatus))) {
      throw new Error(`${slotPath}.matchStatus 不受支持`);
    }
    if (slot.rightsStatus !== undefined && !ASSET_RIGHTS_STATUSES.has(String(slot.rightsStatus))) {
      throw new Error(`${slotPath}.rightsStatus 不受支持`);
    }
    if (slot.assetSnapshot !== undefined && slot.assetSnapshot !== null) {
      validateAssetSnapshot(slot.assetSnapshot, `${slotPath}.assetSnapshot`);
    }
  });

  const review = value.review;
  if (!isRecord(review)) throw new Error(`${path}.review 格式无效`);
  if (typeof review.approved !== 'boolean') throw new Error(`${path}.review.approved 必须是布尔值`);
  for (const key of ['reviewer', 'note']) requireString(review, key, `${path}.review`);
  if (review.approvedAt !== undefined) requireFiniteNumber(review, 'approvedAt', `${path}.review`);

  if (value.events !== undefined && value.events !== null) {
    if (!Array.isArray(value.events)) throw new Error(`${path}.events 必须是数组`);
    value.events.forEach((event, eventIndex) => {
      validateRunEvent(event, `${path}.events[${eventIndex}]`);
    });
  }
  validatePublishRef(value.publishRef, `${path}.publishRef`);
  validateVoiceSettings(value.voiceSettings, `${path}.voiceSettings`);
  validateVoiceover(value.voiceover, `${path}.voiceover`);
  validateSubtitles(value.subtitles, `${path}.subtitles`);

  validatePack(value.pack, `${path}.pack`);
  validatePack(value.draftPack, `${path}.draftPack`);
  const events = Array.isArray(value.events) && value.events.length > MAX_RUN_EVENTS
    ? value.events.slice(-MAX_RUN_EVENTS)
    : value.events;
  return { ...value, ...(events ? { events } : {}) } as unknown as ProductionRun;
}

// ── 营销工作台 / 素材类记录的校验 ─────────────────────────────
// 这几张表以前只做 `as` 断言就写库，畸形备份会在渲染时才炸
// （例如 pages/MarketingBriefs.tsx 的 brief.keySellingPoints.join(...) 与 brief.plan.length）。
// 原则：UI 会直接解引用的字段必须校验，未知字段保留原样（方便向前兼容）。

const EXPERIMENT_METRICS = new Set(['views', 'likes', 'comments', 'coins', 'favorites', 'shares']);
const EXPERIMENT_STATUSES = new Set(['planned', 'running', 'completed', 'inconclusive']);
const CAMPAIGN_PHASES = new Set(['teaser', 'launch', 'sustain']);
const CAMPAIGN_STATUSES = new Set(['planned', 'in-progress', 'published', 'reviewed']);

function requireStringArray(row: Record<string, unknown>, key: string, path: string): string[] {
  const value = row[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${path}.${key} 必须是文本数组`);
  return value as string[];
}

function validateExperiment(value: unknown, index: number): ContentExperiment {
  const path = `marketingWorkbench.experiments[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  const id = requireString(value, 'id', path);
  if (!id.trim()) throw new Error(`${path} 缺少 ID`);
  for (const key of ['title', 'hypothesis', 'variable', 'conclusion', 'nextAction']) requireString(value, key, path);
  if (!EXPERIMENT_METRICS.has(String(value.metric))) throw new Error(`${path}.metric 不受支持`);
  if (!EXPERIMENT_STATUSES.has(String(value.status))) throw new Error(`${path}.status 不受支持`);
  if (!['real', 'demo'].includes(String(value.evidenceMode))) throw new Error(`${path}.evidenceMode 不受支持`);
  requireFiniteNumber(value, 'minimumSampleSize', path);
  requireFiniteNumber(value, 'startedAt', path);
  requireFiniteNumber(value, 'updatedAt', path);
  const topicIds = requireStringArray(value, 'topicIds', path);
  let assignments: ContentExperiment['assignments'];
  if (value.assignments !== undefined) {
    if (!Array.isArray(value.assignments)) throw new Error(`${path}.assignments 必须是数组`);
    assignments = value.assignments.map((item, itemIndex) => {
      const itemPath = `${path}.assignments[${itemIndex}]`;
      if (!isRecord(item)) throw new Error(`${itemPath} 格式无效`);
      const group = String(item.group);
      if (group !== 'control' && group !== 'variant') throw new Error(`${itemPath}.group 不受支持`);
      return { topicId: requireString(item, 'topicId', itemPath), group };
    });
  }
  return { ...value, topicIds, ...(assignments ? { assignments } : {}) } as unknown as ContentExperiment;
}

function validateCampaignPlanItem(value: unknown, path: string): CampaignPlanItem {
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  const id = requireString(value, 'id', path);
  if (!id.trim()) throw new Error(`${path} 缺少 ID`);
  if (!CAMPAIGN_PHASES.has(String(value.phase))) throw new Error(`${path}.phase 不受支持`);
  if (!CAMPAIGN_STATUSES.has(String(value.status))) throw new Error(`${path}.status 不受支持`);
  for (const key of ['channel', 'contentAngle', 'targetMetric']) requireString(value, key, path);
  if (value.publishAt !== undefined) requireFiniteNumber(value, 'publishAt', path);
  if (value.targetValue !== undefined) requireFiniteNumber(value, 'targetValue', path);
  return value as unknown as CampaignPlanItem;
}

function validateBrief(value: unknown, index: number): GameMarketingBrief {
  const path = `marketingWorkbench.briefs[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  const id = requireString(value, 'id', path);
  if (!id.trim()) throw new Error(`${path} 缺少 ID`);
  for (const key of ['title', 'gameTitle', 'versionName', 'objective', 'targetAudience', 'audienceInsight', 'evidenceNotes', 'budgetNote', 'successDefinition', 'retrospective']) requireString(value, key, path);
  requireStringArray(value, 'keySellingPoints', path);
  if (!['planning', 'demo', 'real'].includes(String(value.dataMode))) throw new Error(`${path}.dataMode 不受支持`);
  requireFiniteNumber(value, 'createdAt', path);
  requireFiniteNumber(value, 'updatedAt', path);
  if (!Array.isArray(value.plan)) throw new Error(`${path}.plan 必须是数组`);
  return { ...value, plan: value.plan.map((item, itemIndex) => validateCampaignPlanItem(item, `${path}.plan[${itemIndex}]`)) } as unknown as GameMarketingBrief;
}

function validateFavorite(value: unknown, index: number): MaterialFavorite {
  const path = `materialFavorites[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['id', 'assetId', 'collection', 'note']) requireString(value, key, path);
  requireFiniteNumber(value, 'createdAt', path);
  return value as unknown as MaterialFavorite;
}

function validateAttachment(value: unknown, index: number): BriefAttachment {
  const path = `briefAttachments[${index}]`;
  if (!isRecord(value)) throw new Error(`${path} 格式无效`);
  for (const key of ['id', 'briefId', 'assetId', 'note']) requireString(value, key, path);
  requireFiniteNumber(value, 'createdAt', path);
  return value as unknown as BriefAttachment;
}

function countDuplicates(rows: Array<{ id: string }>): number {
  const seen = new Set<string>();
  let duplicates = 0;
  for (const row of rows) {
    if (seen.has(row.id)) duplicates += 1;
    seen.add(row.id);
  }
  return duplicates;
}

export async function createLocalBackup(): Promise<LocalBackup> {
  const { useScriptStore } = await import('../store/scriptStore');
  useScriptStore.getState().flushPendingWrites();
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  const [topics, scripts, assets, workbench, materialFavorites, briefAttachments, runs, runCosts, runBatches] = await Promise.all([db.topics.toArray(), db.scripts.toArray(), db.assets.toArray(), db.marketingWorkbench.get('workspace'), db.materialFavorites.toArray(), db.briefAttachments.toArray(), db.runs.toArray(), db.runCosts.toArray(), db.runBatches.toArray()]);
  const experiments = workbench?.experiments ?? [];
  const briefs = workbench?.briefs ?? [];
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    appVersion: import.meta.env.VITE_APP_VERSION ?? 'unknown',
    topics,
    scripts,
    assets,
    materialFavorites,
    briefAttachments,
    marketingWorkbench: { experiments, briefs },
    runs,
    runCosts,
    runBatches,
  };
}

export function downloadLocalBackup(backup: LocalBackup): void {
  const date = new Date(backup.exportedAt).toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `creator-studio-backup-${date}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function inspectLocalBackup(file: File): Promise<BackupPreview> {
  if (file.size <= 0) throw new Error('备份文件为空');
  if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 20 MB 限制');
  let payload: unknown;
  try {
    payload = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error('文件不是有效的 JSON 备份');
  }
  if (!isRecord(payload)) throw new Error('备份文件结构无效');
  if (payload.format !== BACKUP_FORMAT) throw new Error('这不是 Creator Studio 的本地备份文件');
  const version = Number(payload.version);
  if (![1, 2, 3, 4].includes(version)) throw new Error(`不支持的备份版本：${String(payload.version)}`);
  if (!Array.isArray(payload.topics) || !Array.isArray(payload.scripts)) throw new Error('备份中缺少选题或脚本数据');
  const assetRows = Array.isArray(payload.assets) ? payload.assets : [];
  const workbench = (payload.marketingWorkbench && typeof payload.marketingWorkbench === 'object' ? payload.marketingWorkbench : { experiments: Array.isArray(payload.experiments) ? payload.experiments : [], briefs: Array.isArray(payload.briefs) ? payload.briefs : [] }) as Record<string, unknown>;
  const experimentRows = Array.isArray(workbench.experiments) ? workbench.experiments : [];
  const briefRows = Array.isArray(workbench.briefs) ? workbench.briefs : [];
  const favoriteRows = Array.isArray(payload.materialFavorites) ? payload.materialFavorites : [];
  const attachmentRows = Array.isArray(payload.briefAttachments) ? payload.briefAttachments : [];
  const runRows = Array.isArray(payload.runs) ? payload.runs : [];
  const costRows = Array.isArray(payload.runCosts) ? payload.runCosts : [];
  const batchRows = Array.isArray(payload.runBatches) ? payload.runBatches : [];
  if (payload.topics.length + payload.scripts.length + assetRows.length + experimentRows.length + briefRows.length + favoriteRows.length + attachmentRows.length + runRows.length + costRows.length + batchRows.length > MAX_RECORDS) throw new Error('备份记录数超过安全上限');
  const topics = payload.topics.map(validateTopic);
  const scripts = payload.scripts.map(validateScript);
  const assets = assetRows.map((asset, index) => {
    if (!isRecord(asset)) throw new Error(`assets[${index}] 格式无效`);
    for (const key of ['id', 'title', 'type', 'url', 'category', 'note']) requireString(asset, key, `assets[${index}]`);
    requireFiniteNumber(asset, 'createdAt', `assets[${index}]`);
    requireFiniteNumber(asset, 'updatedAt', `assets[${index}]`);
    if (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== 'string')) throw new Error(`assets[${index}].tags 格式无效`);
    if (!['image', 'video', 'audio', 'link', 'document'].includes(String(asset.type))) throw new Error(`assets[${index}].type 不受支持`);
    validateAssetRightsFields(asset, `assets[${index}]`);
    try {
      const parsed = new URL(String(asset.url));
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error();
    } catch {
      throw new Error(`assets[${index}].url 必须是 http/https 链接`);
    }
    return asset as unknown as LibraryAsset;
  });
  const experiments = experimentRows.map((row, index) => validateExperiment(row, index));
  const briefs = briefRows.map((row, index) => validateBrief(row, index));
  const materialFavorites = favoriteRows.map((row, index) => validateFavorite(row, index));
  const briefAttachments = attachmentRows.map((row, index) => validateAttachment(row, index));
  const runs = runRows.map((row, index) => validateRun(row, index));
  const runCosts = costRows.map((row, index) => validateRunCost(row, index));
  const runBatches = batchRows.map((row, index) => validateRunBatch(row, index));
  const duplicateTopicIds = countDuplicates(topics);
  const duplicateScriptIds = countDuplicates(scripts);
  const duplicateRunIds = countDuplicates(runs);
  const duplicateCostIds = countDuplicates(runCosts);
  const duplicateBatchIds = countDuplicates(runBatches);
  if (duplicateTopicIds || duplicateScriptIds || duplicateRunIds || duplicateCostIds || duplicateBatchIds) throw new Error('备份内存在重复记录 ID，请从原始应用重新导出备份');
  const topicIds = new Set(topics.map((topic) => topic.id));
  const orphanScriptCount = scripts.filter((script) => !topicIds.has(script.topicId)).length;
  const scriptIds = new Set(scripts.map((script) => script.id));
  const orphanRunCount = runs.filter((run) => !scriptIds.has(run.scriptId)).length;
  const runIds = new Set(runs.map((run) => run.id));
  const orphanCostCount = runCosts.filter((cost) => !runIds.has(cost.runId)).length;
  const orphanBatchItemCount = runBatches.reduce(
    (sum, batch) => sum + batch.items.filter((item) => item.runId && !runIds.has(item.runId)).length,
    0,
  );
  const warnings: string[] = [];
  if (orphanScriptCount) warnings.push(`${orphanScriptCount} 个脚本关联的选题不在备份中，恢复后仍可在脚本列表查看。`);
  if (orphanRunCount) warnings.push(`${orphanRunCount} 个成片任务关联的脚本不在备份中，任务仍会保留但无法跳回源脚本。`);
  if (orphanCostCount) warnings.push(`${orphanCostCount} 条成本记录关联的成片任务不在备份中。`);
  if (orphanBatchItemCount) warnings.push(`${orphanBatchItemCount} 个批量条目关联的成片任务不在备份中。`);
  if (scripts.some((script) => script.storyboards.length > 500)) warnings.push('部分脚本包含超过 500 个分镜，请确认备份来源可信。');
  return {
    backup: { ...payload, topics, scripts, assets, materialFavorites, briefAttachments, marketingWorkbench: { experiments, briefs }, runs, runCosts, runBatches } as unknown as LocalBackup,
    exportedAt: requireFiniteNumber(payload, 'exportedAt', 'backup'),
    topicCount: topics.length,
    scriptCount: scripts.length,
    assetCount: assets.length,
    experimentCount: experiments.length,
    briefCount: briefs.length,
    favoriteCount: materialFavorites.length,
    attachmentCount: briefAttachments.length,
    storyboardCount: scripts.reduce((sum, script) => sum + script.storyboards.length, 0),
    runCount: runs.length,
    costCount: runCosts.length,
    batchCount: runBatches.length,
    demoCount: topics.filter((topic) => topic.id.startsWith('demo-')).length + scripts.filter((script) => script.id.startsWith('demo-')).length + runs.filter((run) => run.demo).length,
    orphanScriptCount,
    duplicateTopicIds,
    duplicateScriptIds,
    warnings,
  };
}

export async function restoreLocalBackup(backup: LocalBackup, mode: 'replace' | 'merge'): Promise<BackupRestoreResult> {
  let topicCount = backup.topics.length;
  let scriptCount = backup.scripts.length;
  let assetCount = backup.assets.length;
  let experimentCount = backup.marketingWorkbench.experiments.length;
  let briefCount = backup.marketingWorkbench.briefs.length;
  let favoriteCount = backup.materialFavorites.length;
  let attachmentCount = backup.briefAttachments.length;
  let runCount = backup.runs.length;
  const backupCosts = backup.runCosts ?? [];
  const backupBatches = backup.runBatches ?? [];
  let costCount = backupCosts.length;
  let batchCount = backupBatches.length;
  await db.transaction('rw', [db.topics, db.scripts, db.assets, db.marketingWorkbench, db.materialFavorites, db.briefAttachments, db.runs, db.runCosts, db.runBatches], async () => {
    if (mode === 'replace') {
      await db.topics.clear();
      await db.scripts.clear();
      await db.assets.clear();
      await db.marketingWorkbench.clear();
      await db.materialFavorites.clear();
      await db.briefAttachments.clear();
      await db.runs.clear();
      await db.runCosts.clear();
      await db.runBatches.clear();
      if (backup.topics.length) await db.topics.bulkPut(backup.topics);
      if (backup.scripts.length) await db.scripts.bulkPut(backup.scripts);
      if (backup.assets.length) await db.assets.bulkPut(backup.assets);
      if (backup.marketingWorkbench.experiments.length || backup.marketingWorkbench.briefs.length) await db.marketingWorkbench.put({ id: 'workspace', ...backup.marketingWorkbench, updatedAt: Date.now() });
      if (backup.materialFavorites.length) await db.materialFavorites.bulkPut(backup.materialFavorites);
      if (backup.briefAttachments.length) await db.briefAttachments.bulkPut(backup.briefAttachments);
      if (backup.runs.length) await db.runs.bulkPut(backup.runs);
      if (backupCosts.length) await db.runCosts.bulkPut(backupCosts);
      if (backupBatches.length) await db.runBatches.bulkPut(backupBatches);
      return;
    }

    const [existingTopics, existingScripts, existingAssets, existingWorkbench, existingFavorites, existingAttachments, existingRuns, existingCosts, existingBatches] = await Promise.all([db.topics.toArray(), db.scripts.toArray(), db.assets.toArray(), db.marketingWorkbench.get('workspace'), db.materialFavorites.toArray(), db.briefAttachments.toArray(), db.runs.toArray(), db.runCosts.toArray(), db.runBatches.toArray()]);
    const topicIds = new Set(existingTopics.map((topic) => topic.id));
    const scriptIds = new Set(existingScripts.map((script) => script.id));
    const assetIds = new Set(existingAssets.map((asset) => asset.id));
    const experimentIds = new Set((existingWorkbench?.experiments ?? []).map((item) => item.id));
    const briefIds = new Set((existingWorkbench?.briefs ?? []).map((item) => item.id));
    const favoriteIds = new Set(existingFavorites.map((item) => item.id));
    const attachmentIds = new Set(existingAttachments.map((item) => item.id));
    const runIds = new Set(existingRuns.map((item) => item.id));
    const costIds = new Set(existingCosts.map((item) => item.id));
    const batchIds = new Set(existingBatches.map((item) => item.id));
    const newTopics = backup.topics.filter((topic) => !topicIds.has(topic.id));
    const newScripts = backup.scripts.filter((script) => !scriptIds.has(script.id));
    const newAssets = backup.assets.filter((asset) => !assetIds.has(asset.id));
    const newExperiments = backup.marketingWorkbench.experiments.filter((item) => !experimentIds.has(item.id));
    const newBriefs = backup.marketingWorkbench.briefs.filter((item) => !briefIds.has(item.id));
    const newFavorites = backup.materialFavorites.filter((item) => !favoriteIds.has(item.id));
    const newAttachments = backup.briefAttachments.filter((item) => !attachmentIds.has(item.id));
    const newRuns = backup.runs.filter((item) => !runIds.has(item.id));
    const newCosts = backupCosts.filter((item) => !costIds.has(item.id));
    const newBatches = backupBatches.filter((item) => !batchIds.has(item.id));
    topicCount = newTopics.length;
    scriptCount = newScripts.length;
    assetCount = newAssets.length;
    experimentCount = newExperiments.length;
    briefCount = newBriefs.length;
    favoriteCount = newFavorites.length;
    attachmentCount = newAttachments.length;
    runCount = newRuns.length;
    costCount = newCosts.length;
    batchCount = newBatches.length;
    if (newTopics.length) await db.topics.bulkAdd(newTopics);
    if (newScripts.length) await db.scripts.bulkAdd(newScripts);
    if (newAssets.length) await db.assets.bulkAdd(newAssets);
    if (newExperiments.length || newBriefs.length) await db.marketingWorkbench.put({
      id: 'workspace',
      experiments: [...(existingWorkbench?.experiments ?? []), ...newExperiments],
      briefs: [...(existingWorkbench?.briefs ?? []), ...newBriefs],
      updatedAt: Date.now(),
    });
    if (newFavorites.length) await db.materialFavorites.bulkAdd(newFavorites);
    if (newAttachments.length) await db.briefAttachments.bulkAdd(newAttachments);
    if (newRuns.length) await db.runs.bulkAdd(newRuns);
    if (newCosts.length) await db.runCosts.bulkAdd(newCosts);
    if (newBatches.length) await db.runBatches.bulkAdd(newBatches);
  });
  // 恢复出来的数据要尽快进云端，否则下一次「云端较新 → 整表覆盖本地」会把它清掉。
  // 未登录（没有 token）时 scheduleSyncUpload() 会直接返回。
  const { scheduleSyncUpload } = await import('./syncService');
  scheduleSyncUpload();
  return { topicCount, scriptCount, assetCount, experimentCount, briefCount, favoriteCount, attachmentCount, runCount, costCount, batchCount, mode };
}
