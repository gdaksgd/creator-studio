import type {
  AssetSlotKind,
  AssetSlotStatus,
  Platform,
  ProductionRun,
  RunCheckCategory,
  RunCheckLevel,
  RunStageKey,
  RunStageStatus,
  RunStatus,
  Script,
} from '../types';

/**
 * 通用阶段模板：只提供阶段标签/描述。
 * 具体 run 使用哪个流水线由下方 PIPELINES 注册表决定（R3）。
 */
export const PRODUCTION_PIPELINE = {
  id: 'creator-studio-production',
  version: '1.0.0',
  name: '游戏内容成片 v1',
  stages: [
    {
      key: 'lock',
      label: '脚本锁定',
      description: '保存脚本、选题与平台检查的不可变快照。',
    },
    {
      key: 'preflight',
      label: '发布前检查',
      description: '检查脚本完整性、平台规则、素材与版权。',
    },
    {
      key: 'assets',
      label: '素材清单',
      description: '逐个分镜确认素材类型、准备状态与备注。',
    },
    {
      key: 'voice',
      label: '配音',
      description: '用本地 TTS worker 生成配音，记录 provider、音色与时长。',
    },
    {
      key: 'subtitles',
      label: '字幕',
      description: '按 TTS 时间戳和平台预设生成 SRT，并检查行宽/阅读速度。',
    },
    {
      key: 'review',
      label: '人工复核',
      description: '确认版权、写下复核结论并标记通过。',
    },
    {
      key: 'pack',
      label: '导出交接包',
      description: '生成包含脚本、分镜、素材清单与检查结果的 ZIP。',
    },
  ] as const satisfies ReadonlyArray<{
    key: RunStageKey;
    label: string;
    description: string;
  }>,
} as const;

export const RUN_STATUS_META: Record<
  RunStatus,
  { label: string; variant: 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'; description: string }
> = {
  draft: { label: '草稿', variant: 'neutral', description: '刚创建，检查还没完成' },
  blocked: { label: '阻塞', variant: 'danger', description: '存在阻塞项，不能导出发布包' },
  review: { label: '待复核', variant: 'warning', description: '没有阻塞项，等待人工复核' },
  ready: { label: '可导出', variant: 'success', description: '复核通过，可以导出发布包' },
  exported: { label: '已导出', variant: 'info', description: '发布包已生成' },
  archived: { label: '已归档', variant: 'neutral', description: '不再出现在进行中列表' },
};

export const RUN_STAGE_STATUS_META: Record<RunStageStatus, { label: string; tone: string }> = {
  pending: { label: '待处理', tone: 'text-text-muted' },
  active: { label: '进行中', tone: 'text-primary' },
  done: { label: '完成', tone: 'text-success' },
  blocked: { label: '阻塞', tone: 'text-danger' },
};

export const RUN_CHECK_LEVEL_META: Record<
  RunCheckLevel,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral'; icon: 'check' | 'alert' | 'x' | 'info' }
> = {
  block: { label: '阻塞', variant: 'danger', icon: 'x' },
  warn: { label: '提醒', variant: 'warning', icon: 'alert' },
  pass: { label: '通过', variant: 'success', icon: 'check' },
  info: { label: '说明', variant: 'neutral', icon: 'info' },
};

export const ASSET_KIND_LABELS: Record<AssetSlotKind, string> = {
  video: '视频',
  image: '图片',
  graphic: '图形/字幕',
  audio: '音频',
  other: '其他',
  unspecified: '未指定',
};

export const ASSET_STATUS_LABELS: Record<AssetSlotStatus, string> = {
  missing: '待准备',
  ready: '已准备',
  not_needed: '不需要',
};

export const PLATFORM_LABELS = {
  bilibili: 'B站',
  douyin: '抖音',
} as const;

export const VERSION_LABELS = {
  long: '长版',
  short: '短版',
} as const;

// ───────────────────────── 流水线注册表（R3） ─────────────────────────
// 阶段、检查分组、导出文件都由这里的定义驱动；页面和导出不再写死。

export interface PipelineCheckGroup {
  key: string;
  label: string;
  categories: RunCheckCategory[];
}

export interface PipelinePackSection {
  key: string;
  label: string;
  files: string[];
}

export interface PipelineDefinition {
  id: string;
  version: string;
  name: string;
  shortLabel: string;
  description: string;
  stageKeys: RunStageKey[];
  checkGroups: PipelineCheckGroup[];
  packSections: PipelinePackSection[];
  defaultPlatform?: Platform;
}

const FULL_PACK_SECTIONS: PipelinePackSection[] = [
  { key: 'core', label: '说明与清单', files: ['README.md', 'manifest.json'] },
  { key: 'script', label: '脚本与分镜', files: ['script.md', 'shotlist.csv'] },
  { key: 'assets', label: '素材清单', files: ['assets.csv'] },
  { key: 'publish', label: '发布说明', files: ['publish.md'] },
  { key: 'checks', label: '检查与来源', files: ['checks.json', 'source-topic.json'] },
];

const MEDIA_PACK_SECTION: PipelinePackSection = {
  key: 'media',
  label: '配音与字幕',
  files: ['voiceover.mp3', 'subtitles.srt', 'voice.json', 'subtitle.json'],
};

const FULL_PACK_SECTIONS_V2: PipelinePackSection[] = [
  ...FULL_PACK_SECTIONS,
  MEDIA_PACK_SECTION,
];

export const GAME_LONGFORM_PIPELINE: PipelineDefinition = {
  id: 'game-longform',
  version: '1',
  name: 'B站长解说',
  shortLabel: '长解说',
  description: '五阶段完整流水线；检查 B站长版的 3–10 分钟时长、章节节奏与平台规则。',
  stageKeys: ['lock', 'preflight', 'assets', 'review', 'pack'],
  checkGroups: [
    { key: 'script', label: '脚本与分镜', categories: ['script'] },
    { key: 'platform', label: '平台规则', categories: ['platform'] },
    { key: 'evidence', label: '选题依据', categories: ['evidence'] },
    { key: 'pipeline', label: '长版节奏', categories: ['pipeline'] },
    { key: 'assets', label: '素材', categories: ['assets'] },
    { key: 'rights', label: '版权', categories: ['rights'] },
  ],
  packSections: FULL_PACK_SECTIONS,
  defaultPlatform: 'bilibili',
};

export const GAME_SHORTFORM_PIPELINE: PipelineDefinition = {
  id: 'game-shortform',
  version: '1',
  name: '抖音短切片',
  shortLabel: '短切片',
  description: '五阶段完整流水线；额外检查开场钩子与 1–3 分钟短版节奏，导出完整脚本包。',
  stageKeys: ['lock', 'preflight', 'assets', 'review', 'pack'],
  checkGroups: [
    { key: 'script', label: '脚本与分镜', categories: ['script'] },
    { key: 'platform', label: '平台规则', categories: ['platform'] },
    { key: 'evidence', label: '选题依据', categories: ['evidence'] },
    { key: 'pipeline', label: '短版钩子', categories: ['pipeline'] },
    { key: 'assets', label: '素材', categories: ['assets'] },
    { key: 'rights', label: '版权', categories: ['rights'] },
  ],
  packSections: FULL_PACK_SECTIONS,
  defaultPlatform: 'douyin',
};

export const GAME_LONGFORM_V2_PIPELINE: PipelineDefinition = {
  id: 'game-longform',
  version: '2',
  name: 'B站长解说',
  shortLabel: '长解说',
  description: '七阶段完整流水线；在素材后增加配音与字幕，检查 B站长版时长、章节节奏、音频与字幕质量。',
  stageKeys: ['lock', 'preflight', 'assets', 'voice', 'subtitles', 'review', 'pack'],
  checkGroups: [
    { key: 'script', label: '脚本与分镜', categories: ['script'] },
    { key: 'platform', label: '平台规则', categories: ['platform'] },
    { key: 'evidence', label: '选题依据', categories: ['evidence'] },
    { key: 'pipeline', label: '长版节奏', categories: ['pipeline'] },
    { key: 'voice', label: '配音', categories: ['voice'] },
    { key: 'subtitles', label: '字幕', categories: ['subtitles'] },
    { key: 'assets', label: '素材', categories: ['assets'] },
    { key: 'rights', label: '版权', categories: ['rights'] },
  ],
  packSections: FULL_PACK_SECTIONS_V2,
  defaultPlatform: 'bilibili',
};

export const GAME_SHORTFORM_V2_PIPELINE: PipelineDefinition = {
  id: 'game-shortform',
  version: '2',
  name: '抖音短切片',
  shortLabel: '短切片',
  description: '七阶段完整流水线；在素材后增加配音与字幕，检查短版钩子、1–3 分钟节奏和字幕阅读速度。',
  stageKeys: ['lock', 'preflight', 'assets', 'voice', 'subtitles', 'review', 'pack'],
  checkGroups: [
    { key: 'script', label: '脚本与分镜', categories: ['script'] },
    { key: 'platform', label: '平台规则', categories: ['platform'] },
    { key: 'evidence', label: '选题依据', categories: ['evidence'] },
    { key: 'pipeline', label: '短版钩子', categories: ['pipeline'] },
    { key: 'voice', label: '配音', categories: ['voice'] },
    { key: 'subtitles', label: '字幕', categories: ['subtitles'] },
    { key: 'assets', label: '素材', categories: ['assets'] },
    { key: 'rights', label: '版权', categories: ['rights'] },
  ],
  packSections: FULL_PACK_SECTIONS_V2,
  defaultPlatform: 'douyin',
};

export const VERSION_MARKETING_PIPELINE: PipelineDefinition = {
  id: 'version-marketing-pack',
  version: '1',
  name: '版本营销素材包',
  shortLabel: '营销包',
  description: '简报 → 素材清单 → 发布包；不跑平台规则、不含完整分镜，适合版本传播物料。',
  stageKeys: ['lock', 'assets', 'pack'],
  checkGroups: [
    { key: 'script', label: '简报内容', categories: ['script'] },
    { key: 'pipeline', label: '营销检查', categories: ['pipeline'] },
    { key: 'assets', label: '素材', categories: ['assets'] },
    { key: 'rights', label: '版权', categories: ['rights'] },
  ],
  packSections: FULL_PACK_SECTIONS.filter((section) => section.key !== 'script'),
};

/** 新建任务可选的当前版本（R5 起长/短版默认带配音与字幕）。 */
export const PIPELINES: PipelineDefinition[] = [
  GAME_LONGFORM_V2_PIPELINE,
  GAME_SHORTFORM_V2_PIPELINE,
  VERSION_MARKETING_PIPELINE,
];

const ALL_PIPELINES: PipelineDefinition[] = [
  ...PIPELINES,
  GAME_LONGFORM_PIPELINE,
  GAME_SHORTFORM_PIPELINE,
];

/** 没有 pipelineId 的旧 run 按 v1 读取，保证不突然要求配音/字幕。 */
export const DEFAULT_PIPELINE = GAME_LONGFORM_PIPELINE;

export function getPipeline(id?: string, version?: string): PipelineDefinition {
  if (!id) return DEFAULT_PIPELINE;
  const matches = ALL_PIPELINES.filter((pipeline) => pipeline.id === id);
  if (!matches.length) return DEFAULT_PIPELINE;
  if (version) return matches.find((pipeline) => pipeline.version === version) ?? matches[0];
  return matches[0];
}

export function getRunPipeline(
  run: Pick<ProductionRun, 'pipelineId' | 'pipelineVersion'>,
): PipelineDefinition {
  if (!run.pipelineId) return DEFAULT_PIPELINE;
  return getPipeline(run.pipelineId, run.pipelineVersion ?? '1');
}

/** 新建任务默认推断到当前版本（v2）。 */
export function inferPipeline(script: Pick<Script, 'platform' | 'version'>): PipelineDefinition {
  if (script.version === 'short' || script.platform === 'douyin') return GAME_SHORTFORM_V2_PIPELINE;
  return GAME_LONGFORM_V2_PIPELINE;
}

export function getPipelinePackFileNames(
  run: Pick<ProductionRun, 'pipelineId' | 'pipelineVersion'>,
): string[] {
  return getRunPipeline(run).packSections.flatMap((section) => section.files);
}
