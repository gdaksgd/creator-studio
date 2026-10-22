// 创作品类 ID。
// ★ 品类清单在 creator-app/src/config/categories.ts 里维护，
//   新增品类不需要改动这里，用 getCategory() 做运行时回退。
export type GameCategory = string;

export type TopicStatus = 'idea' | 'researching' | 'approved' | 'scripting' | 'done' | 'published';

export type Platform = 'bilibili' | 'douyin';

// ─── B站品类基准线（与 server/src/types.ts 保持同构） ───

/** 一个分布带。★ 全部由真实样本算出，没有任何插值或占位。 */
export interface MetricBand {
  min: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
}

/** 比率带，数值为 0-1 的比率（如点赞率 = 点赞/播放） */
export interface RateBand {
  p25: number;
  median: number;
  p75: number;
}

export type BenchmarkScope = 'category' | 'partition' | 'game';

export interface BenchmarkSample {
  scope: BenchmarkScope;
  key: string;
  label: string;
  sampleSize: number;
  source: 'bilibili-popular' | 'bilibili-search';
  sourceLabel: string;
  /** 时间窗（天）。null = 榜单快照口径，不是一个时间窗 */
  windowDays: number | null;
  collectedAt: number;
  views: MetricBand;
  durations: MetricBand;
  /** 某个指标该来源不提供时，键直接不存在（不是 0） */
  rates: {
    like?: RateBand;
    coin?: RateBand;
    favorite?: RateBand;
    share?: RateBand;
    danmaku?: RateBand;
    comment?: RateBand;
  };
  /** 明确列出该样本算不出来的指标及原因，界面上原样展示 */
  unavailable: string[];
  viewDistribution: number[];
}

/** AI 评估结论的依据声明：benchmark = 有真实样本；ai = 纯模型判断 */
export interface BenchmarkBasis {
  source: 'benchmark' | 'ai';
  scope?: BenchmarkScope;
  key?: string;
  label?: string;
  sampleSize?: number;
  windowDays?: number | null;
  /** 该选题预估播放量在样本中的分位（0-100），算不出时不存在 */
  percentile?: number;
}

/** 样本不足的记录，用于解释「为什么这个品类没有基准线」 */
export interface BenchmarkGap {
  key: string;
  label: string;
  sampleSize: number;
  needed: number;
}

export interface BenchmarkSnapshot {
  ready: boolean;
  collecting: boolean;
  collectedAt: number | null;
  error?: string;
  samples: BenchmarkSample[];
  gaps: BenchmarkGap[];
}

// ─── M3：《B站游戏区内容分析报告》──────────────────────────
// 与 server/src/types.ts 的 M3 类型块一一对应。数字一律用 ReportMetric
// （值 + 展示串 + 出处），前端不允许自己 format 出一个没有出处的数字。

/** 报告里每个数字的来源声明 */
export interface ReportBasis {
  source: 'bilibili-popular' | 'bilibili-search' | 'derived';
  sourceLabel: string;
  sampleSize: number;
  /** null = 榜单快照口径，不是一个时间窗 */
  windowDays: number | null;
  collectedAt: number;
  method: string;
}

/** 一个带出处的数字。display 是唯一允许显示给用户的形态。 */
export interface ReportMetric {
  label: string;
  value: number;
  display: string;
  unit: 'views' | 'rate' | 'seconds' | 'count' | 'chars' | 'ratio';
  basis: ReportBasis;
}

export type CompetitionIntensity = 'high' | 'medium' | 'low';

export interface ReportCategoryLine {
  key: string;
  label: string;
  sampleSize: number;
  windowDays: number | null;
  sourceLabel: string;
  viewMedian: ReportMetric;
  viewP90: ReportMetric;
  likeRateMedian: ReportMetric | null;
  concentration: ReportMetric;
  intensity: CompetitionIntensity;
  questionRatio: ReportMetric;
  durationMedian: ReportMetric;
  unavailable: string[];
}

export interface ReportKeyword {
  word: string;
  count: number;
  ratio: number;
}

export interface ReportTitlePattern {
  basis: ReportBasis;
  /** 样本不足时这四项为 null（不是 0）——样本不够就不给数字 */
  questionRatio: ReportMetric | null;
  lengthP25: ReportMetric | null;
  lengthMedian: ReportMetric | null;
  lengthP75: ReportMetric | null;
  lengthBuckets: Array<{ label: string; count: number; ratio: number }>;
  keywords: ReportKeyword[];
  caveat: string;
}

export interface ReportDurationBucket {
  label: string;
  minSec: number;
  maxSec: number | null;
  videoCount: number;
  viewMedian: ReportMetric;
  likeRateMedian: ReportMetric | null;
}

export interface ReportDurationCurve {
  basis: ReportBasis;
  buckets: ReportDurationBucket[];
  bestBucket: string | null;
  trend: 'decreasing' | 'increasing' | 'flat' | 'unknown';
  caveat: string;
}

export interface ReportTimingBucket {
  hour: number;
  videoCount: number;
  viewMedian: number;
}

export interface ReportPublishTiming {
  basis: ReportBasis;
  timezone: string;
  buckets: ReportTimingBucket[];
  topHours: number[];
  caveat: string;
}

export interface ReportEvidence {
  claim: string;
  origin: string;
  grade: 'A' | 'B' | 'C';
  usedIn: string;
}

export interface ReportSuggestion {
  text: string;
  basis?: ReportBasis;
}

export interface ReportSelfCheck {
  metricCount: number;
  unbackedMetricCount: number;
}

export interface GameIndustryReport {
  ready: boolean;
  error?: string;
  generatedAt: number;
  days: number;
  scope: ReportBasis;
  poolSize: number;
  categories: ReportCategoryLine[];
  titlePattern: ReportTitlePattern;
  durationCurve: ReportDurationCurve;
  publishTiming: ReportPublishTiming;
  suggestions: ReportSuggestion[];
  evidence: ReportEvidence[];
  unavailable: string[];
  selfCheck: ReportSelfCheck;
}

export interface TopicEvaluation {
  score: number;
  heatLevel: number;
  competitionLevel: number;
  difficulty: string;
  estimatedViews: string;
  suggestions: string;
  titleSuggestions: string[];
  risks: string;
  bestPlatform: string;
  bestTime: string;
  evaluatedAt: number;
  /** ★ 本次评估的数据依据：benchmark = 引用了真实样本；ai = 没有数据支撑，纯模型判断 */
  basis?: BenchmarkBasis;
}

export interface IdeaEvaluation {
  feasibilityScore: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string;
  recommendedApproach: string;
  scriptFocus: string;
  evaluatedAt: number;
}

export interface TitleEvaluation {
  score: number;
  analysis: string;
  strengths: string[];
  weaknesses: string[];
  alternativeTitles: string[];
  evaluatedAt: number;
}

// ===== 素材工坊类型 =====

export type MaterialType = 'bgm' | 'sfx' | 'meme' | 'animation';

export type LibraryAssetType = 'image' | 'video' | 'audio' | 'link' | 'document';
export type AssetSourceType = 'local' | 'stock' | 'ai' | 'original';
export type AssetLicense = 'own' | 'licensed' | 'cc' | 'unknown';

/** User-owned reusable reference, kept in local IndexedDB and optional account sync. */
export interface LibraryAsset {
  id: string;
  title: string;
  type: LibraryAssetType;
  url: string;
  category: GameCategory;
  tags: string[];
  note: string;
  folder?: string;
  relatedScriptId?: string;
  lastUsedAt?: number;
  favorite?: boolean;
  /** R4：素材来源与授权元数据；旧记录没有这些字段时显示「未记录」，不推断授权。 */
  sourceType?: AssetSourceType;
  license?: AssetLicense;
  licenseUrl?: string;
  /** 授权到期时间（毫秒）；未记录 = 不按到期阻塞，但界面会标明未记录。 */
  expiresAt?: number;
  allowedPlatforms?: Platform[];
  checksum?: string;
  usageCount?: number;
  createdAt: number;
  updatedAt: number;
}

export interface MaterialFavorite {
  id: string;
  assetId: string;
  collection: string;
  note: string;
  createdAt: number;
}

export interface BriefAttachment {
  id: string;
  briefId: string;
  assetId: string;
  note: string;
  createdAt: number;
}

export interface MarketingWorkbenchData {
  experiments: ContentExperiment[];
  briefs: GameMarketingBrief[];
}

export interface MarketingWorkbenchRecord extends MarketingWorkbenchData {
  id: 'workspace';
  updatedAt: number;
}

export interface SearchLink {
  platform: string;
  url: string;
}

export interface AnimeSource {
  series: string;
  episode: string;
  timestamp: string;
}

export interface MaterialRecommendation {
  title: string;
  description: string;
  reason: string;
  source: string;
  searchLinks: SearchLink[];
  selected: boolean;
  isOfficial?: boolean;
  animeSource?: AnimeSource;
}

export interface SceneMaterialCategory {
  needed: boolean;
  mood: string;
  keywords: string;
  recommendations: MaterialRecommendation[];
}

export interface SceneMaterialAnalysis {
  sceneNumber: number;
  sceneDescription: string;
  dialogue: string;
  bgm: SceneMaterialCategory;
  sfx: SceneMaterialCategory;
  meme: SceneMaterialCategory;
  animation: SceneMaterialCategory;
}

export interface MaterialPlan {
  scenes: SceneMaterialAnalysis[];
  analyzedAt: number;
  scriptId: string;
}

/**
 * 发布结果。只有真正发布之后才写入。
 * ★ source='auto' 表示所有数字都来自 B站接口；'manual' 表示人工填写。
 *   字段缺失 = 未知。不要用 0 冒充「数据是 0」——0 播放和「还没发布」是两件事。
 */
export interface PublishedRecord {
  platform: Platform;
  bvid?: string;
  url?: string;
  title: string;
  /** 发布时间（毫秒） */
  publishedAt: number;
  /** 时长（秒） */
  duration?: number;
  views?: number;
  likes?: number;
  coins?: number;
  favorites?: number;
  shares?: number;
  comments?: number;
  danmaku?: number;
  /** 取数时间（毫秒）；手动填写时等于填写时间 */
  fetchedAt: number;
  source: 'auto' | 'manual';
  /** 后续回填时间线：同一 BVID 再次刷新时追加快照，不覆盖旧指标历史。 */
  snapshots?: Array<{
    fetchedAt: number;
    views?: number;
    likes?: number;
    coins?: number;
    favorites?: number;
    shares?: number;
    comments?: number;
    danmaku?: number;
  }>;
}

export interface Topic {
  id: string;
  title: string;
  category: GameCategory;
  status: TopicStatus;
  difficulty: 1 | 2 | 3 | 4 | 5;
  /** Display value kept for compatibility with older backups and cloud records. */
  estimatedViews: number;
  prediction?: {
    value: number;
    source: 'ai' | 'manual';
    updatedAt: number;
  };
  urgency: 'low' | 'medium' | 'high';
  notes: string;
  productionIdea: string;
  gameDescription: string;
  createdAt: number;
  updatedAt: number;
  evaluation?: TopicEvaluation;
  ideaEvaluation?: IdeaEvaluation;
  titleEvaluation?: TitleEvaluation;
  materialPlan?: MaterialPlan;
  /**
   * 发布结果。没有这个字段 = 尚未发布。
   * 不要写成 { views: 0 }——那是「播放量为 0」，与「还没发出去」是两件事。
   */
  published?: PublishedRecord;
  retrospective?: {
    tags: RetrospectiveTag[];
    note: string;
    updatedAt: number;
  };
  contentExperimentIds?: string[];
  plannedPublishAt?: number;
  productionDueAt?: number;
}

export type RetrospectiveTag = 'topic' | 'title' | 'cover' | 'hook' | 'pacing' | 'duration' | 'timing' | 'distribution' | 'production' | 'other';

export type ContentExperimentStatus = 'planned' | 'running' | 'completed' | 'inconclusive';
export type ExperimentMetric = 'views' | 'likes' | 'comments' | 'coins' | 'favorites' | 'shares';

/** A hypothesis/variable/metric plan; conclusions are written by the user, never auto-claimed causal. */
export interface ContentExperiment {
  id: string;
  title: string;
  hypothesis: string;
  variable: string;
  metric: ExperimentMetric;
  successThreshold?: number;
  status: ContentExperimentStatus;
  topicIds: string[];
  /** Explicit comparison-group mapping. Missing legacy rows default to variant for display only. */
  assignments?: Array<{ topicId: string; group: 'control' | 'variant' }>;
  conclusion: string;
  nextAction: string;
  evidenceMode: 'real' | 'demo';
  minimumSampleSize: number;
  startedAt: number;
  completedAt?: number;
  updatedAt: number;
}

export type CampaignPhase = 'teaser' | 'launch' | 'sustain';

export interface CampaignPlanItem {
  id: string;
  phase: CampaignPhase;
  publishAt?: number;
  channel: string;
  contentAngle: string;
  linkedTopicId?: string;
  targetMetric: string;
  targetValue?: number;
  status: 'planned' | 'in-progress' | 'published' | 'reviewed';
}

export interface GameMarketingBrief {
  id: string;
  title: string;
  gameTitle: string;
  versionName: string;
  objective: string;
  targetAudience: string;
  audienceInsight: string;
  keySellingPoints: string[];
  evidenceNotes: string;
  budgetNote: string;
  successDefinition: string;
  plan: CampaignPlanItem[];
  retrospective: string;
  linkedExperimentId?: string;
  dataMode: 'planning' | 'demo' | 'real';
  createdAt: number;
  updatedAt: number;
}

export interface Storyboard {
  id: string;
  sceneNumber: number;
  description: string;
  dialogue: string;
  duration: number;
  notes: string;
  visualDirection: string;
}

export interface Script {
  id: string;
  topicId: string;
  platform: Platform;
  version: 'long' | 'short';
  title: string;
  hook: string;
  storyboards: Storyboard[];
  notes: string;
  createdAt: number;
  updatedAt: number;
  /**
   * 平台适配检查面板里手填的内容（封面文案 / CTR / 完播率 / 更新频率）。
   * 随脚本一起落 IndexedDB 并参与云同步，所以关掉页面、重开这条脚本都不会丢。
   */
  platformCheck?: PlatformCheckInput;
  /** Bounded snapshots embedded in the script record so they sync with the script. */
  history?: ScriptRevision[];
}

export interface ScriptRevision {
  id: string;
  savedAt: number;
  label: string;
  title: string;
  hook: string;
  storyboards: Storyboard[];
  notes: string;
  platformCheck?: PlatformCheckInput;
}

// ───────────────────────── M4 · 平台适配检查（纯规则引擎，与 server/src/services/platformRules.ts 对应） ─────────────────────────

export type RuleStatus = 'pass' | 'warn' | 'fail' | 'info';
/** A = 平台官方 / 同行评审；B = 第三方大样本；C = 经验帖或本项目自定义（不用于 KPI） */
export type EvidenceLevel = 'A' | 'B' | 'C';

export interface RuleEvidence {
  source: string;
  level: EvidenceLevel;
  note?: string;
}

export interface PlatformRule {
  id: string;
  label: string;
  status: RuleStatus;
  detail: string;
  hint?: string;
  evidence: RuleEvidence;
}

export interface DurationAdvice {
  target: string;
  targetSec: [number, number];
  status: RuleStatus;
  detail: string;
  evidence: RuleEvidence;
  hint?: string;
  completionReference?: { text: string; evidence: RuleEvidence };
}

export interface PlatformCheck {
  platform: Platform;
  platformLabel: string;
  engine: string;
  durationAdvice: DurationAdvice;
  rules: PlatformRule[];
  summary: { total: number; pass: number; warn: number; fail: number; info: number; sourced: number };
  checkedAt: number;
  disclaimer: string;
}

export interface CoverPolishResult {
  coverCandidates: string[];
  titleCandidates: string[];
  rationale: string;
  model: string;
}

export interface CoverCheckResponse {
  ok: boolean;
  check: PlatformCheck;
  aiUsed: boolean;
  ai?: CoverPolishResult;
  aiError?: string;
}

/**
 * 用户在「平台适配检查」面板里手填、需要长期保存的内容。
 * updatedAt 用于在界面上显示「上次填写时间」，也让云同步能判断新旧。
 *
 * v1.5.2 起只保留封面文案：CTR / 完播率 / 更新频率是发布后才知道的指标，
 * 不再在脚本期收集（旧记录里若还留着这几个字段，读的时候忽略、写的时候原样保留）。
 */
export interface PlatformCheckInput {
  coverText: string;
  updatedAt: number;
}

// ───────────────────────── 成片任务（Production Run）v1 ─────────────────────────
// 一次生产任务对应一个脚本快照、一个平台版本；任务本身不随源脚本变化。

export type RunStatus = 'draft' | 'blocked' | 'review' | 'ready' | 'exported' | 'archived';
export type RunStageKey = 'lock' | 'preflight' | 'assets' | 'voice' | 'subtitles' | 'review' | 'pack';
export type RunStageStatus = 'pending' | 'active' | 'done' | 'blocked';
export type RunCheckLevel = 'block' | 'warn' | 'pass' | 'info';
export type RunCheckSource = 'local' | 'platform' | 'topic';
export type RunCheckCategory =
  | 'script'
  | 'platform'
  | 'evidence'
  | 'assets'
  | 'rights'
  | 'pipeline'
  | 'voice'
  | 'subtitles';

export interface RunEvidence {
  source: string;
  level: 'A' | 'B' | 'C';
  note?: string;
}

export interface RunCheck {
  id: string;
  category: RunCheckCategory;
  label: string;
  level: RunCheckLevel;
  detail: string;
  hint?: string;
  source: RunCheckSource;
  evidence?: RunEvidence;
  checkedAt: number;
}

export type AssetSlotKind = 'video' | 'image' | 'graphic' | 'audio' | 'other' | 'unspecified';
export type AssetSlotStatus = 'missing' | 'ready' | 'not_needed';
export type AssetMatchStatus = 'unmatched' | 'suggested' | 'matched' | 'missing';
export type AssetRightsStatus = 'ok' | 'unknown' | 'expired' | 'platform_blocked';

/** 关联素材库时保存的授权快照；导出 assets.csv 和预检都以此为准。 */
export interface AssetSlotAssetSnapshot {
  id: string;
  title: string;
  url: string;
  sourceType?: AssetSourceType;
  license?: AssetLicense;
  licenseUrl?: string;
  expiresAt?: number;
  allowedPlatforms?: Platform[];
  checksum?: string;
}

export interface AssetSlot {
  id: string;
  storyboardId: string;
  sceneNumber: number;
  description: string;
  visualDirection: string;
  duration: number;
  kind: AssetSlotKind;
  status: AssetSlotStatus;
  note: string;
  /** R4：关联的素材库记录；旧任务没有这些字段时按未关联/未记录处理。 */
  assetId?: string;
  assetSnapshot?: AssetSlotAssetSnapshot;
  matchStatus?: AssetMatchStatus;
  rightsStatus?: AssetRightsStatus;
}

export interface RunStage {
  key: RunStageKey;
  label: string;
  status: RunStageStatus;
  startedAt?: number;
  finishedAt?: number;
}

export interface RunSnapshot {
  capturedAt: number;
  scriptUpdatedAt: number;
  script: Omit<Script, 'history'>;
  topic?: Pick<Topic, 'id' | 'title' | 'category' | 'status' | 'evaluation'> &
    Partial<Pick<Topic, 'notes' | 'gameDescription' | 'productionIdea'>>;
  platformCheck?: PlatformCheck;
  platformCheckError?: string;
}

export interface RunReview {
  approved: boolean;
  reviewer: string;
  note: string;
  approvedAt?: number;
}

export interface RunPackRecord {
  exportedAt: number;
  fileName: string;
  fileCount: number;
  mode: 'publish' | 'draft';
  /** 导出后任务内容发生变化时为 true；发布包需要重新导出 */
  stale?: boolean;
}

export type RunEventType =
  | 'created'
  | 'checked'
  | 'asset_updated'
  | 'rights_confirmed'
  | 'rights_revoked'
  | 'review_approved'
  | 'review_revoked'
  | 'pack_exported'
  | 'archived'
  | 'note_updated'
  | 'publish_bound'
  | 'publish_unbound'
  | 'voice_generated'
  | 'voice_failed'
  | 'subtitles_generated'
  | 'subtitles_failed';

/** 运行事件只记录操作摘要，不保存脚本全文、台词或隐私内容。 */
export interface RunEvent {
  id: string;
  type: RunEventType;
  at: number;
  actor: string;
  summary: string;
  meta?: Record<string, string | number | boolean | null>;
}

/** 成片任务与选题发布记录的本地绑定；不改动 Topic.published。 */
export interface RunPublishRef {
  topicId: string;
  platform: Platform;
  bvid?: string;
  url?: string;
  title?: string;
  publishedAt: number;
  boundAt: number;
}

export type SubtitlePresetId = 'bilibili' | 'douyin';

export interface RunVoiceBoundary {
  startMs: number;
  endMs: number;
  text: string;
}

export interface RunVoiceSettings {
  voice: string;
  rate: string;
  pitch: string;
}

export interface RunVoiceover {
  status: 'ready' | 'failed';
  provider: string;
  voice: string;
  rate: string;
  pitch: string;
  mediaId?: string;
  fileName?: string;
  mime?: string;
  size?: number;
  durationSec?: number;
  generatedAt?: number;
  boundaries?: RunVoiceBoundary[];
  error?: string;
}

export interface RunSubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface RunSubtitles {
  status: 'ready' | 'failed';
  preset: SubtitlePresetId;
  format: 'srt';
  fileName?: string;
  cueCount?: number;
  charCount?: number;
  maxLineChars?: number;
  maxCharsPerSecond?: number;
  timingSource?: 'tts-sentence' | 'estimated';
  generatedAt?: number;
  cues?: RunSubtitleCue[];
  content?: string;
  error?: string;
}

export type CostCapability =
  | 'llm'
  | 'tts'
  | 'image'
  | 'video'
  | 'stock'
  | 'platform'
  | 'data'
  | 'manual';

/** 一次供应商/操作的成本记录。成本为 null 表示「供应商未返回可核对数字」，不补 0。 */
export interface RunCostEntry {
  id: string;
  runId: string;
  providerId: string;
  capability: CostCapability;
  operation: string;
  units: number;
  unitLabel: string;
  estimatedCost: number | null;
  actualCost: number | null;
  currency: 'CNY';
  source: 'local' | 'api' | 'manual';
  at: number;
  note?: string;
  batchId?: string;
}

export type RunBatchItemStatus = 'pending' | 'running' | 'done' | 'failed';
export type RunBatchStatus = 'draft' | 'running' | 'completed' | 'partial' | 'failed';

export interface RunBatchItem {
  runId: string;
  scriptId: string;
  runTitle: string;
  platform: Platform;
  version: 'long' | 'short';
  status: RunBatchItemStatus;
  attempts: number;
  error?: string;
  updatedAt?: number;
}

export interface RunBatch {
  id: string;
  title: string;
  items: RunBatchItem[];
  status: RunBatchStatus;
  concurrency: number;
  actor?: string;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

/** 本机媒体记录：只在 IndexedDB 里，不进备份/云同步。 */
export interface RunMediaRecord {
  id: string;
  runId: string;
  kind: 'voiceover';
  fileName: string;
  mime: string;
  size: number;
  durationSec: number;
  blob: Blob;
  createdAt: number;
}

export interface ProductionRun {
  id: string;
  title: string;
  topicId: string;
  scriptId: string;
  platform: Platform;
  version: 'long' | 'short';
  /** 流水线 id/version；旧任务没有这两个字段时按 game-longform@1 读取 */
  pipelineId?: string;
  pipelineVersion?: string;
  /** 同组生产：一个 campaign 下挂多条不同平台的 run */
  campaignId?: string;
  variantOfRunId?: string;
  status: RunStatus;
  stage: RunStageKey;
  createdAt: number;
  updatedAt: number;
  snapshot: RunSnapshot;
  checks: RunCheck[];
  assetSlots: AssetSlot[];
  rightsConfirmed: boolean;
  review: RunReview;
  /** 最近一次发布包导出记录；只有 ready 状态才能生成 */
  pack?: RunPackRecord;
  /** 最近一次草稿包导出记录；不影响任务状态 */
  draftPack?: RunPackRecord;
  /** 追加式操作时间线；旧任务没有这个字段，读取时按 [] 处理 */
  events?: RunEvent[];
  /** 绑定的发布记录；只存在本机任务里，不同步云端 */
  publishRef?: RunPublishRef;
  /** R5：配音与字幕工件；音频 Blob 存在本机 runMedia 表，不进备份/云同步 */
  voiceSettings?: RunVoiceSettings;
  voiceover?: RunVoiceover;
  subtitles?: RunSubtitles;
  demo?: boolean;
  notes: string;
}
