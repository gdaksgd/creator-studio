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
