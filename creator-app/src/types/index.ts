export type GameCategory = 'card' | 'horror';

export type TopicStatus = 'idea' | 'researching' | 'approved' | 'scripting' | 'done';

export type Platform = 'bilibili' | 'douyin';

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
