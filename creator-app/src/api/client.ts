import type { BenchmarkSnapshot, GameIndustryReport, CoverCheckResponse } from '../types';

const API_BASE = '/api';

/** 报告接口的成功响应包装（后端在 ok=false 时直接返回非 2xx，由 request() 抛 ApiError） */
export interface ReportResponse {
  ok: boolean;
  report: GameIndustryReport;
}

/** 带 HTTP 状态码与后端业务错误码的错误，便于调用方按 code 分支处理 */
export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// ===== 账号制云端同步：token 存取 =====
/** token 在 localStorage 里的键名（与后端账号体系约定一致，不要在别处另起名字） */
export const AUTH_TOKEN_KEY = 'creator-studio-token';

/** 内存缓存，避免每个请求都读 localStorage */
let authToken: string | null = null;

/** 登录 / 退出时调用：同时更新内存缓存与 localStorage */
export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* 隐私模式下写不了 localStorage，token 只在本次会话生效 */
  }
}

/**
 * 取当前 token：内存里没有时回读 localStorage。
 * 这样「刷新页面后、init() 还没跑完」时发出的请求也能带上 Bearer。
 */
function readAuthToken(): string | null {
  if (authToken) return authToken;
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  // 有 token 才注入 Authorization；没有就不加，保持「本地优先」时的旧行为。
  // 后端对缺/过期 token 的 /sync/upload、/sync/download 会返回 401 UNAUTHORIZED。
  const token = readAuthToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (!resp.ok) {
    const body = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new ApiError(body.error || '请求失败', resp.status, body.code);
  }

  return resp.json();
}

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  sourceType: 'rss' | 'youtube' | 'bilibili' | 'steam';
  // 品类 id 由 config/categories.ts 定义，用 getCategory() 做兜底
  category: string;
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

/**
 * B站单条视频真实数据（由后端 /api/video/stat 从 B站 view 接口归一化而来）。
 * 每个字段都直接来自接口，没有推断值。
 */
export interface VideoStat {
  bvid: string;
  title: string;
  url: string;
  publishedAt: number;
  duration: number;
  views: number;
  likes: number;
  coins: number;
  favorites: number;
  shares: number;
  comments: number;
  danmaku: number;
  fetchedAt: number;
}

export interface VideoStatResponse {
  ok: boolean;
  stat?: VideoStat;
  error?: string;
  code?: 'BAD_INPUT' | 'NOT_FOUND' | 'RISK_CONTROL' | 'UPSTREAM' | 'NETWORK' | 'SERVER_ERROR';
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

export interface MaterialRecommendation {
  title: string;
  description: string;
  reason: string;
  source: string;
  searchLinks: SearchLink[];
  selected: boolean;
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

// ===== 账号制云端同步类型 =====
/** 云账号用户（后端 /api/auth/* 返回） */
export interface AuthUser {
  id: string;
  username: string;
  /** 后端可能给时间戳或 ISO 字符串，前端只展示不参与计算 */
  createdAt?: number | string;
}

/** 该账号云端已保存的数据概况（/api/auth/me） */
export interface CloudUsage {
  uploadedAt: number;
  topicCount: number;
  scriptCount: number;
}

/** 注册 / 登录成功后的返回 */
export interface AuthSession {
  token: string;
  user: AuthUser;
}

/** /api/auth/me 的返回 */
export interface AuthMeResponse {
  user: AuthUser;
  cloud: CloudUsage;
}

/** 这次请求的 AI Key 来自哪里：账号自己的 / 站点公共配置 / 都没配 */
export type AiKeySource = 'account' | 'server' | 'none';

/** /api/ai/status 的返回 */
export interface AiStatusResponse {
  aiConfigured: boolean;
  aiSource: AiKeySource;
  /** 站点是否配了 YouTube 数据源（只用于展示状态，配置方法不给用户看） */
  youtubeConfigured: boolean;
  accountInfo: AccountInfo;
  legacyAnalyticsAvailable?: boolean;
}

/** /api/ai-config 的返回：一个账号一份 AI 配置，Key 只回掩码 */
export interface AiConfigView {
  configured: boolean;
  maskedKey: string | null;
  updatedAt: number | null;
  serverConfigured: boolean;
}

export const api = {
  // News
  getNews: (params?: { category?: string; sourceType?: string; limit?: number }) => {
    const query = new URLSearchParams();
    if (params?.category) query.set('category', params.category);
    if (params?.sourceType) query.set('sourceType', params.sourceType);
    if (params?.limit) query.set('limit', String(params.limit));
    return request<{ news: NewsItem[]; total: number; lastCollected: number | null }>(
      `/news?${query}`
    );
  },

  collectNews: () => request<{ success: boolean; total: number; sources: Record<string, number> }>('/news/collect', { method: 'POST' }),

  markAsTopic: (id: string) => request<{ success: boolean }>(`/news/${id}/mark-topic`, { method: 'POST' }),

  // AI
  evaluateTopic: (data: { topicTitle: string; category: string; notes: string; gameDescription?: string }) =>
    request<TopicEvaluation>('/ai/evaluate-topic', { method: 'POST', body: JSON.stringify(data) }),

  evaluateIdea: (data: { topicTitle: string; category: string; productionIdea: string; gameDescription?: string }) =>
    request<IdeaEvaluation>('/ai/evaluate-idea', { method: 'POST', body: JSON.stringify(data) }),

  evaluateScriptTitle: (data: { gameTitle: string; gameDescription: string; scriptTitle: string; category: string }) =>
    request<TitleEvaluation>('/ai/evaluate-title', { method: 'POST', body: JSON.stringify(data) }),

  suggestScript: (data: {
    topicTitle: string;
    category: string;
    platform: string;
    version: string;
    scriptTitle: string;
    hook: string;
    storyboards: any[];
  }) => request<ScriptSuggestion>('/ai/script-suggest', { method: 'POST', body: JSON.stringify(data) }),

  generateScript: (data: { topicTitle: string; category: string; platform: string; version: string; productionIdea?: string; gameDescription?: string }) =>
    request<{ hook: string; storyboards: any[] }>('/ai/generate-script', { method: 'POST', body: JSON.stringify(data) }),

  // Materials
  analyzeMaterials: (data: {
    topicTitle: string;
    category: string;
    productionIdea?: string;
    gameDescription?: string;
    scriptTitle: string;
    hook: string;
    storyboards: any[];
  }) => request<{ scenes: SceneMaterialAnalysis[] }>('/ai/materials/analyze', { method: 'POST', body: JSON.stringify(data) }),

  // Account
  getAccount: () => request<AccountInfo>('/ai/account'),
  updateAccount: (data: Partial<AccountInfo>) =>
    request<AccountInfo>('/ai/account', { method: 'POST', body: JSON.stringify(data) }),
  syncAccount: () =>
    request<SyncResult>('/ai/account/sync', { method: 'POST' }),
  getSyncHistory: () =>
    request<SyncHistoryEntry[]>('/ai/account/history'),
  getAccountSyncStatus: () =>
    request<{ configured: boolean; updatedAt: number }>('/ai/account/sync-status'),
  getLegacyAnalyticsClaimStatus: () =>
    request<{ available: boolean; syncHistoryCount: number }>('/ai/account/legacy-claim-status'),
  claimLegacyAnalytics: () =>
    request<{ claimed: boolean }>('/ai/account/claim-legacy', { method: 'POST' }),

  // Status
  getStatus: () => request<AiStatusResponse>('/ai/status'),

  // 账号级 AI 配置（一个账号一份 DeepSeek Key；明文只进不出，读回来的是掩码）
  getAiConfig: () => request<AiConfigView>('/ai-config'),
  // apiKey 传空字符串 = 清除本账号的 Key（退回站点公共配置）
  updateAiConfig: (apiKey: string) =>
    request<AiConfigView>('/ai-config', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
  // 不传 key 就测账号里已保存的那个
  testAiConfig: (apiKey?: string) =>
    request<{ ok: boolean; message: string }>('/ai-config/test', {
      method: 'POST',
      body: JSON.stringify(apiKey ? { apiKey } : {}),
    }),

  // 重新翻译全部新闻标题
  retranslate: () =>
    request<{ translated: number; total: number }>('/ai/retranslate', { method: 'POST' }),

  // Cloud Sync
  // baseUploadedAt: 上次同步到的云端时间戳，用于乐观锁。云端更新时后端返回 409 CONFLICT
  uploadSync: (data: { topics: any[]; scripts: any[]; assets?: any[]; materialFavorites?: any[]; briefAttachments?: any[]; marketingWorkbench?: any; uploadedAt: number; baseUploadedAt?: number }) =>
    request<{ success: boolean; uploadedAt: number }>('/sync/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // empty: 云端查询成功但无数据（与「查询失败」区分开）
  downloadSync: () =>
    request<{ topics: any[]; scripts: any[]; assets?: any[]; materialFavorites?: any[]; briefAttachments?: any[]; marketingWorkbench?: { experiments?: any[]; briefs?: any[] }; uploadedAt: number; empty?: boolean }>('/sync/download'),

  getSyncStatus: () =>
    request<{ syncConfigured: boolean }>('/sync/status'),

  // Auth（账号制云端同步）
  // ★ 503 NOT_CONFIGURED = 服务端没配 Supabase，云账号不可用（本地功能不受影响）。
  // ★ /auth/status 不需要 token，用来判断「云账号是否可用」。
  authRegister: (data: { username: string; password: string }) =>
    request<AuthSession>('/auth/register', { method: 'POST', body: JSON.stringify(data) }),

  authLogin: (data: { username: string; password: string }) =>
    request<AuthSession>('/auth/login', { method: 'POST', body: JSON.stringify(data) }),

  authMe: () => request<AuthMeResponse>('/auth/me'),

  authLogout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),

  getAuthStatus: () => request<{ authConfigured: boolean }>('/auth/status'),

  // B站单条视频真实数据：粘贴链接 → 精确取数（用于「记录发布」）
  // ★ 注意：ok=false 时后端依旧返回 200，用 code 区分 BAD_INPUT / NOT_FOUND / RISK_CONTROL / NETWORK。
  //   调用方必须处理 ok=false，不能把「取不到」当成「播放量为 0」。
  getVideoStat: (url: string) =>
    request<VideoStatResponse>(`/video/stat?url=${encodeURIComponent(url)}`),
  getVideoStats: (urls: string[]) =>
    request<{ results: VideoStatResponse[]; total: number; okCount: number }>('/video/stats', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    }),

  // B站品类基准线
  // ★ ready=false 表示还没采到样本（冷启动 / 采集失败），界面上必须显示「暂无基准数据」，
  //   绝不能用 0 或占位数字顶替。
  getBenchmark: () => request<BenchmarkSnapshot>('/benchmark'),
  refreshBenchmark: () => request<BenchmarkSnapshot>('/benchmark/refresh', { method: 'POST' }),

  // M3 分析报告
  // ★ ready=false 时后端返回 503 NOT_READY（不是空报告），调用方据此显示「正在补采」。
  getReport: (days?: number) =>
    request<ReportResponse>(`/report/game-industry${days === undefined ? '' : `?days=${days}`}`),

  // Markdown 导出：由后端渲染，前端只负责触发下载。
  // 放在后端是为了让「导出件」可被冒烟测试直接断言（见 tools/smoke-test.ps1）。
  reportMarkdownUrl: (days?: number) =>
    `${API_BASE}/report/game-industry.md${days === undefined ? '' : `?days=${days}`}`,

  // M4 平台适配检查：纯规则引擎（服务器不需要 AI 也能给出全部结论）。
  // ★ useAI=true 才会调用 AI 润色文案，也才会消耗每日 AI 配额；默认不传就是纯规则。
  // ★ 每条规则都带 evidence{source,level}，界面上必须显示，不能只显示结论。
  evaluateCover: (payload: {
    platform: 'bilibili' | 'douyin';
    title?: string;
    coverText?: string;
    durationSec?: number;
    useAI?: boolean;
  }) =>
    request<CoverCheckResponse>('/ai/evaluate-cover', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
};
