// 资讯品类 ID。
// ★ 清单在 server/src/config/categories.ts 里维护，新增品类不需要改这里。
export type NewsCategory = string;
export type NewsSource = 'rss' | 'youtube' | 'bilibili' | 'steam';

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  sourceType: NewsSource;
  category: NewsCategory;
  thumbnail?: string;
  publishedAt: number;
  collectedAt: number;
  metrics?: {
    views?: number;
    likes?: number;
    comments?: number;
  };
  savedAsTopic?: boolean;
  translatedTitle?: string;
}

export interface AccountInfo {
  bilibiliFollowers: number;
  bilibiliAvgViews: number;
  douyinFollowers: number;
  douyinAvgViews: number;
  contentFocus: string;
  daysActive: number;
  totalVideos: number;
  // Auto-sync fields
  bilibiliUid?: string;
  douyinId?: string;
  lastSyncAt?: number;
  bilibiliName?: string;
  bilibiliTotalLikes?: number;
  douyinName?: string;
  douyinTotalVideos?: number;
  douyinTotalLikes?: number;
  syncMessage?: string;
}

export interface SyncHistoryEntry {
  timestamp: number;
  bilibiliFollowers: number;
  bilibiliAvgViews: number;
  bilibiliTotalLikes: number;
  bilibiliVideos: number;
  douyinFollowers: number;
  douyinAvgViews: number;
  douyinTotalLikes: number;
  douyinVideos: number;
}

export interface SyncResult {
  success: boolean;
  message: string;
  syncedFields: string[];
  failedFields: string[];
  accountInfo: AccountInfo;
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
  /** 这次判断的依据来源。缺失表示 AI 在没有基准数据的情况下作答。 */
  basis?: BenchmarkBasis;
}

export interface IdeaEvaluation {
  feasibilityScore: number;
  strengths: string[];
  weaknesses: string[];
  suggestions: string;
  recommendedApproach: string;
  scriptFocus: string;
}

export interface TitleEvaluation {
  score: number;
  analysis: string;
  strengths: string[];
  weaknesses: string[];
  alternativeTitles: string[];
}

export interface ScriptSuggestion {
  hookSuggestions: string[];
  structureAdvice: string;
  pacingAdvice: string;
  dialogueTips: string[];
  improvementPoints: string[];
  'b-rollIdeas': string[];
}

// ===== 素材工坊类型 =====

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

export interface MaterialAnalysisResponse {
  scenes: SceneMaterialAnalysis[];
}

// ===== 发布结果 / B站视频真实数据 =====

/**
 * 从 B站 view 接口归一化出来的单条视频真实数据。
 * ★ 这里每个数字都直接来自接口返回值，没有任何推断、预估或占位值。
 *   拿不到数据时上层必须报错，不允许用 0 伪装成「有数据」。
 */
export interface VideoStat {
  bvid: string;
  title: string;
  url: string;
  /** 发布时间（毫秒） */
  publishedAt: number;
  /** 时长（秒） */
  duration: number;
  views: number;
  likes: number;
  coins: number;
  favorites: number;
  shares: number;
  comments: number;
  danmaku: number;
  /** 本次取数时间（毫秒），用于判断数据新鲜度 */
  fetchedAt: number;
}

// ===== 品类 / 分区基准线（M2） =====

/**
 * 一个分布带。★ 全部由真实样本算出，没有任何插值或占位。
 * 样本量不足时上层根本不会生成 BenchmarkSample，而不是造一个 0 出来。
 */
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
  /** 作用域标识：品类 id（如 horror）或 B站子分区名（如 单机游戏） */
  key: string;
  label: string;
  sampleSize: number;
  /** 机器可读的来源标识 */
  source: 'bilibili-popular' | 'bilibili-search';
  /** 展示给用户的来源说明 */
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
  /** 明确列出该样本算不出来的指标及原因，供界面原样展示 */
  unavailable: string[];
  /** 升序排列的全部播放量，用于计算某条视频所处的分位 */
  viewDistribution: number[];
}

/** AI 评估结论的依据声明 */
export interface BenchmarkBasis {
  /** benchmark = 有真实样本支撑；ai = 无样本，纯模型判断 */
  source: 'benchmark' | 'ai';
  scope?: BenchmarkScope;
  key?: string;
  label?: string;
  sampleSize?: number;
  windowDays?: number | null;
  /** 该选题预估播放量在样本中的分位（0-100），算不出时不存在 */
  percentile?: number;
}

/** 样本不足的记录，用于向前端解释「为什么这个品类没有基准线」 */
export interface BenchmarkGap {
  key: string;
  label: string;
  sampleSize: number;
  needed: number;
}

/** 基准线快照的接口响应 */
export interface BenchmarkSnapshot {
  ready: boolean;
  collecting: boolean;
  collectedAt: number | null;
  /** 采集失败时的原因（有旧缓存时仍返回旧数据） */
  error?: string;
  samples: BenchmarkSample[];
  gaps: BenchmarkGap[];
}

// ===== 分析报告（M3） =====

/**
 * 报告里每个数字的来源声明。
 * ★ M3 的硬规则：报告中的任何数字都必须挂一个 ReportBasis，
 *   没有 basis 的数字在类型层面就构造不出来，Markdown 导出同理。
 */
export interface ReportBasis {
  /** 机器可读来源；derived = 由同批样本二次计算得到 */
  source: 'bilibili-popular' | 'bilibili-search' | 'derived';
  /** 展示用来源说明（自带样本量与时间窗） */
  sourceLabel: string;
  sampleSize: number;
  /** 时间窗（天）。null = 榜单快照口径，不是一个时间窗 */
  windowDays: number | null;
  collectedAt: number;
  /** 统计口径，例如「中位数」「播放量前 10% 占比」 */
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

/** 品类维度的竞争强度分档（阈值口径写在 basis.method 里） */
export type CompetitionIntensity = 'high' | 'medium' | 'low';

export interface ReportCategoryLine {
  key: string;
  label: string;
  sampleSize: number;
  windowDays: number | null;
  sourceLabel: string;
  viewMedian: ReportMetric;
  viewP90: ReportMetric;
  /** 该来源不提供点赞数时为 null（不是 0） */
  likeRateMedian: ReportMetric | null;
  /** 头部集中度：播放量前 10% 的视频占样本总播放的比例 */
  concentration: ReportMetric;
  intensity: CompetitionIntensity;
  /** 标题里出现问号的占比（同一样本口径） */
  questionRatio: ReportMetric;
  durationMedian: ReportMetric;
  unavailable: string[];
}

export interface ReportKeyword {
  word: string;
  count: number;
  /** count / sampleSize */
  ratio: number;
}

export interface ReportTitlePattern {
  basis: ReportBasis;
  questionRatio: ReportMetric;
  lengthP25: ReportMetric;
  lengthMedian: ReportMetric;
  lengthP75: ReportMetric;
  /** 标题字数分桶：分布形态用，不做「最佳字数」结论 */
  lengthBuckets: Array<{ label: string; count: number; ratio: number }>;
  keywords: ReportKeyword[];
  /** 关键词抽取方法的局限，必须原样展示 */
  caveat: string;
}

export interface ReportDurationBucket {
  label: string;
  minSec: number;
  maxSec: number | null;
  videoCount: number;
  viewMedian: ReportMetric;
  /** 样本不足以算比率时为 null */
  likeRateMedian: ReportMetric | null;
}

export interface ReportDurationCurve {
  basis: ReportBasis;
  buckets: ReportDurationBucket[];
  /** 点赞率中位最高的桶（要求该桶视频数达标）；都不达标时 null */
  bestBucket: string | null;
  /**
   * 点赞率随时长变化的整体方向（只比较达标桶的最短/最长两端）。
   * M3 的第三个维度要「验证 B站奖励看得久」，所以方向必须由数据说，不能预设。
   */
  trend: 'decreasing' | 'increasing' | 'flat' | 'unknown';
  /** 判定 bestBucket 的门槛说明 */
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
  /** 榜单快照对发布时段有偏，不能当「最佳发布时间」 */
  caveat: string;
}

/** 报告引用的外部证据（含可信度分级，见计划书附录 B） */
export interface ReportEvidence {
  claim: string;
  origin: string;
  grade: 'A' | 'B' | 'C';
  /** 这份报告里哪个维度用到了它 */
  usedIn: string;
}

export interface ReportSuggestion {
  text: string;
  /** 引用了数据时必带；纯方法论建议没有数据支撑时不存在 */
  basis?: ReportBasis;
}

/**
 * 报告自检：报告里一共多少个数字、其中多少个没有出处。
 * unbackedMetricCount 必须恒为 0 —— 冒烟测试会直接断言它，
 * 这样「导出内容不含任何无出处数字」就不是靠人看，而是靠代码保证。
 */
export interface ReportSelfCheck {
  metricCount: number;
  unbackedMetricCount: number;
}

/** 《B站游戏区内容分析报告》 */
export interface GameIndustryReport {
  ready: boolean;
  /** 生成失败或口径不可用时的原因 */
  error?: string;
  generatedAt: number;
  /** 报告采用的时间窗口（天） */
  days: number;
  /** 整份报告的总口径声明 */
  scope: ReportBasis;
  poolSize: number;
  categories: ReportCategoryLine[];
  titlePattern: ReportTitlePattern;
  durationCurve: ReportDurationCurve;
  publishTiming: ReportPublishTiming;
  suggestions: ReportSuggestion[];
  evidence: ReportEvidence[];
  /** 明确列不出来的维度与原因 */
  unavailable: string[];
  /** 自检结果；unbackedMetricCount > 0 说明程序有缺陷 */
  selfCheck: ReportSelfCheck;
}
