const API_BASE = '/api';

function getAuthPassword(): string {
  return localStorage.getItem('auth_password') || '';
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-auth-password': getAuthPassword(),
  };

  if (options?.headers) {
    Object.assign(headers, options.headers);
  }

  const resp = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (resp.status === 401) {
    // Password invalid, clear and redirect to login
    localStorage.removeItem('auth_password');
    window.location.reload();
    throw new Error('密码错误');
  }

  if (!resp.ok) {
    const error = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(error.error || '请求失败');
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
  category: 'card' | 'horror' | 'general';
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

  // Status
  getStatus: () => request<{ aiConfigured: boolean; accountInfo: AccountInfo }>('/ai/status'),

  // Auth
  checkPassword: (password: string) =>
    request<{ success: boolean; configured: boolean }>('/auth/check', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  // Cloud Sync
  uploadSync: (data: { topics: any[]; scripts: any[]; uploadedAt: number }) =>
    request<{ success: boolean; uploadedAt: number }>('/sync/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  downloadSync: () =>
    request<{ topics: any[]; scripts: any[]; uploadedAt: number }>('/sync/download'),

  getSyncStatus: () =>
    request<{ syncConfigured: boolean }>('/sync/status'),
};
