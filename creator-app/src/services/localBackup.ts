import { db } from '../db';
import type { BriefAttachment, CampaignPlanItem, ContentExperiment, GameMarketingBrief, LibraryAsset, MaterialFavorite, Script, Storyboard, Topic } from '../types';

const BACKUP_FORMAT = 'creator-studio-local-backup';
const BACKUP_VERSION = 2;
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
  const [topics, scripts, assets, workbench, materialFavorites, briefAttachments] = await Promise.all([db.topics.toArray(), db.scripts.toArray(), db.assets.toArray(), db.marketingWorkbench.get('workspace'), db.materialFavorites.toArray(), db.briefAttachments.toArray()]);
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
  if (payload.version !== 1 && payload.version !== BACKUP_VERSION) throw new Error(`不支持的备份版本：${String(payload.version)}`);
  if (!Array.isArray(payload.topics) || !Array.isArray(payload.scripts)) throw new Error('备份中缺少选题或脚本数据');
  const assetRows = Array.isArray(payload.assets) ? payload.assets : [];
  const workbench = (payload.marketingWorkbench && typeof payload.marketingWorkbench === 'object' ? payload.marketingWorkbench : { experiments: Array.isArray(payload.experiments) ? payload.experiments : [], briefs: Array.isArray(payload.briefs) ? payload.briefs : [] }) as Record<string, unknown>;
  const experimentRows = Array.isArray(workbench.experiments) ? workbench.experiments : [];
  const briefRows = Array.isArray(workbench.briefs) ? workbench.briefs : [];
  const favoriteRows = Array.isArray(payload.materialFavorites) ? payload.materialFavorites : [];
  const attachmentRows = Array.isArray(payload.briefAttachments) ? payload.briefAttachments : [];
  if (payload.topics.length + payload.scripts.length + assetRows.length + experimentRows.length + briefRows.length + favoriteRows.length + attachmentRows.length > MAX_RECORDS) throw new Error('备份记录数超过安全上限');
  const topics = payload.topics.map(validateTopic);
  const scripts = payload.scripts.map(validateScript);
  const assets = assetRows.map((asset, index) => {
    if (!isRecord(asset)) throw new Error(`assets[${index}] 格式无效`);
    for (const key of ['id', 'title', 'type', 'url', 'category', 'note']) requireString(asset, key, `assets[${index}]`);
    requireFiniteNumber(asset, 'createdAt', `assets[${index}]`);
    requireFiniteNumber(asset, 'updatedAt', `assets[${index}]`);
    if (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== 'string')) throw new Error(`assets[${index}].tags 格式无效`);
    if (!['image', 'video', 'audio', 'link', 'document'].includes(String(asset.type))) throw new Error(`assets[${index}].type 不受支持`);
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
  const duplicateTopicIds = countDuplicates(topics);
  const duplicateScriptIds = countDuplicates(scripts);
  if (duplicateTopicIds || duplicateScriptIds) throw new Error('备份内存在重复记录 ID，请从原始应用重新导出备份');
  const topicIds = new Set(topics.map((topic) => topic.id));
  const orphanScriptCount = scripts.filter((script) => !topicIds.has(script.topicId)).length;
  const warnings: string[] = [];
  if (orphanScriptCount) warnings.push(`${orphanScriptCount} 个脚本关联的选题不在备份中，恢复后仍可在脚本列表查看。`);
  if (scripts.some((script) => script.storyboards.length > 500)) warnings.push('部分脚本包含超过 500 个分镜，请确认备份来源可信。');
  return {
    backup: { ...payload, topics, scripts, assets, materialFavorites, briefAttachments, marketingWorkbench: { experiments, briefs } } as unknown as LocalBackup,
    exportedAt: requireFiniteNumber(payload, 'exportedAt', 'backup'),
    topicCount: topics.length,
    scriptCount: scripts.length,
    assetCount: assets.length,
    experimentCount: experiments.length,
    briefCount: briefs.length,
    favoriteCount: materialFavorites.length,
    attachmentCount: briefAttachments.length,
    storyboardCount: scripts.reduce((sum, script) => sum + script.storyboards.length, 0),
    demoCount: topics.filter((topic) => topic.id.startsWith('demo-')).length + scripts.filter((script) => script.id.startsWith('demo-')).length,
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
  await db.transaction('rw', [db.topics, db.scripts, db.assets, db.marketingWorkbench, db.materialFavorites, db.briefAttachments], async () => {
    if (mode === 'replace') {
      await db.topics.clear();
      await db.scripts.clear();
      await db.assets.clear();
      await db.marketingWorkbench.clear();
      await db.materialFavorites.clear();
      await db.briefAttachments.clear();
      if (backup.topics.length) await db.topics.bulkPut(backup.topics);
      if (backup.scripts.length) await db.scripts.bulkPut(backup.scripts);
      if (backup.assets.length) await db.assets.bulkPut(backup.assets);
      if (backup.marketingWorkbench.experiments.length || backup.marketingWorkbench.briefs.length) await db.marketingWorkbench.put({ id: 'workspace', ...backup.marketingWorkbench, updatedAt: Date.now() });
      if (backup.materialFavorites.length) await db.materialFavorites.bulkPut(backup.materialFavorites);
      if (backup.briefAttachments.length) await db.briefAttachments.bulkPut(backup.briefAttachments);
      return;
    }

    const [existingTopics, existingScripts, existingAssets, existingWorkbench, existingFavorites, existingAttachments] = await Promise.all([db.topics.toArray(), db.scripts.toArray(), db.assets.toArray(), db.marketingWorkbench.get('workspace'), db.materialFavorites.toArray(), db.briefAttachments.toArray()]);
    const topicIds = new Set(existingTopics.map((topic) => topic.id));
    const scriptIds = new Set(existingScripts.map((script) => script.id));
    const assetIds = new Set(existingAssets.map((asset) => asset.id));
    const experimentIds = new Set((existingWorkbench?.experiments ?? []).map((item) => item.id));
    const briefIds = new Set((existingWorkbench?.briefs ?? []).map((item) => item.id));
    const favoriteIds = new Set(existingFavorites.map((item) => item.id));
    const attachmentIds = new Set(existingAttachments.map((item) => item.id));
    const newTopics = backup.topics.filter((topic) => !topicIds.has(topic.id));
    const newScripts = backup.scripts.filter((script) => !scriptIds.has(script.id));
    const newAssets = backup.assets.filter((asset) => !assetIds.has(asset.id));
    const newExperiments = backup.marketingWorkbench.experiments.filter((item) => !experimentIds.has(item.id));
    const newBriefs = backup.marketingWorkbench.briefs.filter((item) => !briefIds.has(item.id));
    const newFavorites = backup.materialFavorites.filter((item) => !favoriteIds.has(item.id));
    const newAttachments = backup.briefAttachments.filter((item) => !attachmentIds.has(item.id));
    topicCount = newTopics.length;
    scriptCount = newScripts.length;
    assetCount = newAssets.length;
    experimentCount = newExperiments.length;
    briefCount = newBriefs.length;
    favoriteCount = newFavorites.length;
    attachmentCount = newAttachments.length;
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
  });
  // 恢复出来的数据要尽快进云端，否则下一次「云端较新 → 整表覆盖本地」会把它清掉。
  // 未登录（没有 token）时 scheduleSyncUpload() 会直接返回。
  const { scheduleSyncUpload } = await import('./syncService');
  scheduleSyncUpload();
  return { topicCount, scriptCount, assetCount, experimentCount, briefCount, favoriteCount, attachmentCount, mode };
}
