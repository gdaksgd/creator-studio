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
}

export interface Topic {
  id: string;
  title: string;
  category: GameCategory;
  status: TopicStatus;
  difficulty: 1 | 2 | 3 | 4 | 5;
  estimatedViews: number;
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
}
