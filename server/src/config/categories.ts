// ============================================================
//  品类配置 —— 后端单一事实来源
//
//  ★ 新增品类只需在这里加一条，AI 提示词与资讯采集会自动跟随。
//    必须与 frontend 的 creator-app/src/config/categories.ts 保持 id/label 一致。
// ============================================================

export interface CategoryDef {
  /** 稳定 ID，与前端保持一致 */
  id: string;
  label: string;
  short: string;

  /** 该品类的内容调性与观众特征，直接拼进 AI 提示词 */
  aiPersona: string;
  /** AI 评估该品类选题时重点关注的点 */
  aiFocus: string[];
  /** 标题风格建议，用于生成/评估标题 */
  titleStyle: string;

  /** YouTube / 外网采集关键词 */
  newsQueries: string[];
  /** RSS / B站标题分类关键词（命中即归入该品类） */
  rssKeywords: string[];
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'card',
    label: '卡牌游戏',
    short: '卡牌',
    aiPersona: '卡牌游戏玩家，关注卡组强度、天梯环境、新卡评测、赛事meta。看重数据分析和实战表现。',
    aiFocus: ['卡组强度与胜率', '新卡对现有环境的影响', '造价与上手难度', '当前版本meta'],
    titleStyle: '用版本号/卡组名开头，突出强度结论，例如「T0卡组实测」「新版本答案」',
    newsQueries: [
      'hearthstone new deck',
      'yugioh master duel',
      'mtg arena best deck',
      'marvel snap new season',
      'pokemon tcg pocket',
      '卡牌游戏 新卡组',
    ],
    rssKeywords: ['卡牌', '卡组', 'tcg', 'hearthstone', 'yugioh', 'magic the gathering', 'mtg', 'deck', 'pokemon tcg'],
  },
  {
    id: 'horror',
    label: '恐怖游戏',
    short: '恐怖',
    aiPersona: '恐怖游戏观众，追求惊吓体验、氛围营造、剧情反转。对Jump Scare和音效设计敏感。',
    aiFocus: ['恐怖氛围与演出', '剧情悬念与反转', 'Jump Scare 密度', '主播反应素材是否充足'],
    titleStyle: '制造悬念和恐惧预期，例如「被吓到摔键盘」「凌晨三点不敢关灯」',
    newsQueries: [
      'horror game gameplay',
      '恐怖游戏 实况',
      'scariest horror game moments',
      'new indie horror game',
      'survival horror game',
    ],
    rssKeywords: ['horror', '恐怖', 'scary', 'survival horror', 'resident evil', 'silent hill', 'fatal frame'],
  },
  {
    id: 'indie',
    label: '独立游戏',
    short: '独立',
    aiPersona: '独立游戏爱好者，欣赏创意玩法与作者表达，反感流水线作品，乐于发掘冷门佳作。',
    aiFocus: ['玩法创新点', '作者/团队故事', '与同类的差异化', '性价比与内容量'],
    titleStyle: '强调「冷门神作」「被低估」，例如「这款5人做的游戏吊打3A」',
    newsQueries: [
      'indie game hidden gem',
      '独立游戏 推荐',
      'best indie games 2026',
      'pixel art game new',
      'roguelike new release',
    ],
    rssKeywords: ['indie', '独立游戏', 'roguelike', 'pixel art', 'early access'],
  },
  {
    id: 'rpg',
    label: 'RPG / 剧情向',
    short: 'RPG',
    aiPersona: '剧情党玩家，重视世界观、人物塑造、叙事深度，喜欢长视频解析和多周目讨论。',
    aiFocus: ['剧情深度与叙事手法', '角色塑造', '世界观完整度', '剧情向解析空间'],
    titleStyle: '突出剧情钩子与解析价值，例如「结局我看了三遍才懂」「被低估的神级剧情」',
    newsQueries: [
      'best rpg 2026',
      'RPG 剧情 解析',
      'jrpg new release',
      'story rich game',
      'baldurs gate 3 update',
    ],
    rssKeywords: ['rpg', 'jrpg', '剧情', 'story', 'narrative', '开放世界'],
  },
  {
    id: 'action',
    label: '动作冒险',
    short: '动作',
    aiPersona: '动作游戏玩家，追求操作上限、BOSS 设计和战斗手感，喜欢高难度挑战与速通。',
    aiFocus: ['战斗系统深度', 'BOSS 设计', '难度曲线', '操作观赏性/高光时刻'],
    titleStyle: '突出挑战与爽感，例如「无伤通关」「这个BOSS我打了7小时」',
    newsQueries: [
      'soulslike boss fight',
      'action game gameplay 2026',
      '动作游戏 实况',
      'elden ring build',
      'character action game new',
    ],
    rssKeywords: ['action', 'soulslike', '动作', 'boss', 'hack and slash', 'metroidvania'],
  },
  {
    id: 'sim',
    label: '模拟经营',
    short: '模拟',
    aiPersona: '模拟经营玩家，享受规划与优化的乐趣，喜欢长期存档、数据流和「养成」过程。',
    aiFocus: ['系统深度与可玩性', '上手门槛', '长期游玩动力', '布局/优化空间'],
    titleStyle: '突出规划成果与翻车对比，例如「100小时建成的城市」「新手必踩的坑」',
    newsQueries: [
      'city builder new game',
      '模拟经营 游戏 推荐',
      'colony sim update',
      'farming sim 2026',
      'management game review',
    ],
    rssKeywords: ['simulation', '模拟', '经营', 'city builder', 'colony', 'management', 'farming'],
  },
  {
    id: 'mobile',
    label: '手游',
    short: '手游',
    aiPersona: '手游玩家，关注版本更新、角色强度、抽卡性价比和活动攻略，观看场景碎片化。',
    aiFocus: ['版本更新内容', '角色/武器强度', '抽卡性价比', '活动攻略时效性'],
    titleStyle: '强调版本与结论前置，例如「3.2版本该不该抽」「零氪党的最优解」',
    newsQueries: [
      'gacha game new banner',
      '手游 新版本 攻略',
      'honkai star rail update',
      'genshin impact new character',
      'arknights new event',
    ],
    rssKeywords: ['手游', 'gacha', 'mobile game', '原神', '崩坏', '明日方舟', '抽卡'],
  },
  {
    id: 'industry',
    label: '行业资讯',
    short: '行业',
    aiPersona: '关注游戏行业动态的从业者与核心玩家，关心厂商动向、市场数据和产业趋势。',
    aiFocus: ['事件影响力', '信息源可靠性', '对玩家/从业者的实际影响', '话题延展性'],
    titleStyle: '结论前置+数据支撑，例如「这家厂商为什么突然砍掉整个项目」',
    newsQueries: [
      'game industry news',
      '游戏行业 动态',
      'game studio layoff',
      'games sales report 2026',
      'game publisher acquisition',
    ],
    rssKeywords: ['industry', '行业', 'layoff', 'acquisition', 'revenue', '财报', '裁员', '收购'],
  },
];

/** 不属于任何创作品类的资讯落桶 */
export const GENERAL_CATEGORY: CategoryDef = {
  id: 'general',
  label: '综合资讯',
  short: '综合',
  aiPersona: '',
  aiFocus: [],
  titleStyle: '',
  newsQueries: ['video game news', '游戏资讯'],
  rssKeywords: [],
};

export const ALL_CATEGORIES: CategoryDef[] = [...CATEGORIES, GENERAL_CATEGORY];

const BY_ID: Record<string, CategoryDef> = Object.fromEntries(
  ALL_CATEGORIES.map((c) => [c.id, c]),
);

export const DEFAULT_CATEGORY = 'horror';

export function getCategory(id: string | undefined | null): CategoryDef {
  if (id && BY_ID[id]) return BY_ID[id];
  return BY_ID[DEFAULT_CATEGORY];
}

/** 供 AI 提示词使用：把品类信息压成一段可读描述 */
export function describeCategory(id: string | undefined | null): string {
  const c = getCategory(id);
  if (c.id === 'general') return '综合游戏资讯';
  const focus = c.aiFocus.length ? `，重点关注：${c.aiFocus.join('、')}` : '';
  return `${c.label}（受众特征：${c.aiPersona}${focus}）`;
}

export const CATEGORY_IDS: string[] = ALL_CATEGORIES.map((c) => c.id);
