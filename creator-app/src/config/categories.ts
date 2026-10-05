// ============================================================
//  品类配置 —— 单一事实来源 (Single Source of Truth)
//
//  ★ 新增一个创作品类，只需要在 CATEGORIES 里加一条。
//    UI（看板/筛选/表单/标签）、AI 提示词、资讯采集关键词
//    都会自动跟随，不需要改任何其它文件。
// ============================================================

export interface CategoryDef {
  /** 稳定 ID，会写进数据库，**不要随意改动已存在的 id** */
  id: string;
  /** 完整名称，用于标题、下拉框 */
  label: string;
  /** 紧凑名称，用于标签、筛选器 */
  short: string;
  emoji: string;

  /** Tailwind 徽章样式。必须写成完整字面量，否则 Tailwind 扫描不到不会生成 */
  badge: string;
  /** Tailwind 圆点/强调色 */
  dot: string;

  /** 表单里"标题"字段的叫法（不同品类叫法不同） */
  titleLabel: string;
  titlePlaceholder: string;
  /** 表单里"简介"字段的叫法 */
  descriptionLabel: string;
  descriptionPlaceholder: string;
}

export const CATEGORIES: CategoryDef[] = [
  {
    id: 'card',
    label: '卡牌游戏',
    short: '卡牌',
    emoji: '🃏',
    badge: 'bg-amber-50 text-amber-800 border-amber-200',
    dot: 'bg-amber-500',
    titleLabel: '选题标题',
    titlePlaceholder: '比如：炉石新版本卡组评测、游戏王新卡前瞻...',
    descriptionLabel: '卡组/环境说明',
    descriptionPlaceholder: '当前天梯环境、主流卡组、新卡强度...',
  },
  {
    id: 'horror',
    label: '恐怖游戏',
    short: '恐怖',
    emoji: '👻',
    badge: 'bg-purple-50 text-purple-800 border-purple-200',
    dot: 'bg-purple-500',
    titleLabel: '游戏标题',
    titlePlaceholder: '比如：青鬼、寂静岭、生化危机...',
    descriptionLabel: '游戏简介',
    descriptionPlaceholder: '游戏类型、恐怖元素、剧情背景...',
  },
  {
    id: 'indie',
    label: '独立游戏',
    short: '独立',
    emoji: '🎮',
    badge: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
    titleLabel: '游戏标题',
    titlePlaceholder: '比如：空洞骑士、星露谷物语、潜水员戴夫...',
    descriptionLabel: '游戏简介',
    descriptionPlaceholder: '玩法特色、开发团队、美术风格...',
  },
  {
    id: 'rpg',
    label: 'RPG / 剧情向',
    short: 'RPG',
    emoji: '🗡️',
    badge: 'bg-sky-50 text-sky-800 border-sky-200',
    dot: 'bg-sky-500',
    titleLabel: '游戏标题',
    titlePlaceholder: '比如：博德之门3、巫师3、女神异闻录...',
    descriptionLabel: '游戏简介',
    descriptionPlaceholder: '世界观、剧情主线、角色设定...',
  },
  {
    id: 'action',
    label: '动作冒险',
    short: '动作',
    emoji: '⚔️',
    badge: 'bg-rose-50 text-rose-800 border-rose-200',
    dot: 'bg-rose-500',
    titleLabel: '游戏标题',
    titlePlaceholder: '比如：艾尔登法环、只狼、战神...',
    descriptionLabel: '游戏简介',
    descriptionPlaceholder: '战斗系统、难度曲线、BOSS 设计...',
  },
  {
    id: 'sim',
    label: '模拟经营',
    short: '模拟',
    emoji: '🏗️',
    badge: 'bg-orange-50 text-orange-800 border-orange-200',
    dot: 'bg-orange-500',
    titleLabel: '游戏标题',
    titlePlaceholder: '比如：都市天际线、环世界、双点医院...',
    descriptionLabel: '游戏简介',
    descriptionPlaceholder: '经营玩法、系统深度、上手门槛...',
  },
  {
    id: 'mobile',
    label: '手游',
    short: '手游',
    emoji: '📱',
    badge: 'bg-violet-50 text-violet-800 border-violet-200',
    dot: 'bg-violet-500',
    titleLabel: '游戏标题',
    titlePlaceholder: '比如：原神、崩坏星穹铁道、明日方舟...',
    descriptionLabel: '游戏简介',
    descriptionPlaceholder: '玩法、氪金点、版本活动...',
  },
  {
    id: 'industry',
    label: '行业资讯',
    short: '行业',
    emoji: '📰',
    badge: 'bg-slate-100 text-slate-700 border-slate-300',
    dot: 'bg-slate-500',
    titleLabel: '话题标题',
    titlePlaceholder: '比如：某厂商裁员、新主机发布、行业趋势...',
    descriptionLabel: '话题背景',
    descriptionPlaceholder: '事件经过、涉及方、影响面...',
  },
];

/** 资讯采集专用的落桶（不属于创作品类） */
export const GENERAL_CATEGORY: CategoryDef = {
  id: 'general',
  label: '综合资讯',
  short: '综合',
  emoji: '📌',
  badge: 'bg-gray-100 text-gray-700 border-gray-300',
  dot: 'bg-gray-400',
  titleLabel: '标题',
  titlePlaceholder: '',
  descriptionLabel: '简介',
  descriptionPlaceholder: '',
};

/** 所有可在资讯里出现的品类（创作品类 + 综合） */
export const NEWS_CATEGORIES: CategoryDef[] = [...CATEGORIES, GENERAL_CATEGORY];

const BY_ID: Record<string, CategoryDef> = Object.fromEntries(
  NEWS_CATEGORIES.map((c) => [c.id, c]),
);

export const DEFAULT_CATEGORY = 'horror';

/** 安全取品类定义：未知 id 回退到默认品类，不会抛错 */
export function getCategory(id: string | undefined | null): CategoryDef {
  if (id && BY_ID[id]) return BY_ID[id];
  return BY_ID[DEFAULT_CATEGORY];
}

export function categoryLabel(id: string | undefined | null): string {
  return getCategory(id).label;
}

export function categoryShort(id: string | undefined | null): string {
  return getCategory(id).short;
}

export function categoryBadge(id: string | undefined | null): string {
  return getCategory(id).badge;
}

export function categoryEmoji(id: string | undefined | null): string {
  return getCategory(id).emoji;
}

/** 是否为有效的创作品类（排除 general） */
export function isCreativeCategory(id: string | undefined | null): boolean {
  return !!id && CATEGORIES.some((c) => c.id === id);
}
