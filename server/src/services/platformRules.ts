/**
 * M4 · 平台适配规则引擎（纯规则，零依赖，不调用 AI）
 *
 * 设计原则（与计划书第 3 节一致）：
 *  1. 每条规则都必须带「出处 + 证据等级」，UI 上必须显示，不得伪装成平台官方基准。
 *  2. 引擎本身不调用 AI：没有 DEEPSEEK_API_KEY 也能给出全部结论（AI 只用于可选的润色）。
 *  3. 拿不到的输入（没填封面文案 / 没填 CTR）就不给结论，返回 info 并说明为什么，
 *     绝不用 0 或占位数字顶替。
 *
 * 证据等级：A = 平台官方口径 / 同行评审；B = 第三方大样本；C = 经验帖或本项目自定义（不用于 KPI）。
 */

export type PlatformId = 'bilibili' | 'douyin';
export type RuleStatus = 'pass' | 'warn' | 'fail' | 'info';
export type EvidenceLevel = 'A' | 'B' | 'C';

export interface RuleEvidence {
  /** 出处原文，会直接显示给用户 */
  source: string;
  level: EvidenceLevel;
  /** 口径提醒（例如「非官方」「不可横比」） */
  note?: string;
}

export interface PlatformRule {
  id: string;
  label: string;
  status: RuleStatus;
  /** 结论本身（对用户说的话） */
  detail: string;
  /** 建议动作（可选） */
  hint?: string;
  evidence: RuleEvidence;
}

export interface DurationAdvice {
  /** 建议时长区间的人类可读文案 */
  target: string;
  /** 建议时长区间（秒），便于 UI 与自动化断言 */
  targetSec: [number, number];
  status: RuleStatus;
  detail: string;
  evidence: RuleEvidence;
  /** 时长不在建议区间时给的可执行建议（抖音常是拆条建议） */
  hint?: string;
  /** 该平台该时长的完播率参考（只有抖音有公开分档） */
  completionReference?: { text: string; evidence: RuleEvidence };
}

export interface PlatformCheckInput {
  platform: string;
  /** 视频标题文案 */
  title?: string;
  /** 封面上要写的字（封面文案） */
  coverText?: string;
  /** 预计时长（秒）。不填则跳过时长判断 */
  durationSec?: number;
  /** 封面点击率（%）。只有 YouTube 有公开基准 */
  ctr?: number;
  /** 完播率（%）。只有抖音有第三方分档 */
  completionRate?: number;
  /** 计划更新频率（条/周） */
  postsPerWeek?: number;
}

export interface PlatformCheck {
  platform: PlatformId;
  platformLabel: string;
  engine: string;
  durationAdvice: DurationAdvice;
  rules: PlatformRule[];
  summary: { total: number; pass: number; warn: number; fail: number; info: number; sourced: number };
  checkedAt: number;
  disclaimer: string;
}

// ───────────────────────── 常量与出处 ─────────────────────────

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  bilibili: 'B站',
  douyin: '抖音',
};

/** 纯规则引擎标识：冒烟测试用它断言「没有 AI 也跑得出结论」 */
export const RULE_ENGINE_ID = 'pure-rules-v1';

export const PLATFORM_DURATION_TARGET: Record<PlatformId, { min: number; max: number; text: string }> = {
  bilibili: { min: 180, max: 600, text: '3–10 分钟' },
  douyin: { min: 60, max: 180, text: '1–3 分钟' },
};

const EV_CUI: RuleEvidence = {
  source: 'Cui, Chung, Peng & Wang (2024), Journal of Business Research 183:114849（16,215 个 YouTube 封面，同行评审）',
  level: 'A',
};
const EV_HE: RuleEvidence = {
  source: '贺一、张玮锋《主动检索科普视频时视觉元素对点击行为的影响因素研究——以B站为例》，《科普研究》2023,18(6):41-52',
  level: 'A',
};
const EV_CHEN: RuleEvidence = {
  source: 'B站 CEO 陈睿公开表态（2023-06 起前台播放量改为「播放分钟数」；2023Q1 UGC 中长视频占播放量 70%）',
  level: 'A',
};
const EV_CTR: RuleEvidence = {
  source: 'YouTube 官方 Help Center（CTR 健康区间 2–10%，4–6% 平均，>10% 优秀，<2% 应重做）',
  level: 'A',
  note: '这是 YouTube 的口径；B站/抖音没有公开的 CTR 基准，不能跨平台横比',
};
const EV_CTR_METHOD: RuleEvidence = {
  source: '方法论约束（CTR 随曝光扩大自然下降；不可跨频道/跨赛道横比）',
  level: 'A',
};
const EV_COMPLETION: RuleEvidence = {
  source: '蝉妈妈转述官方定义（抖音完播率：15s >45% / 30s >25% / 1–3min >10% / >3min >5%）',
  level: 'B',
  note: '第三方转述、非官方原文，只作参考区间，不当 KPI',
};
const EV_CADENCE: RuleEvidence = {
  source: '18,000 频道研究（每周 1–2 条并稳定保持该节奏优于堆量）',
  level: 'B',
};
const EV_MORE_VIDEOS: RuleEvidence = {
  source: '20,000 频道研究（更多视频 ≠ 更多播放）',
  level: 'B',
};
const EV_LEXICON: RuleEvidence = {
  source: '本项目自定义词表（server/src/services/platformRules.ts）',
  level: 'C',
  note: '词表是本工具自己定的，不是平台官方口径；只用来说明「命中了哪一类词」',
};
const EV_REVERSE: RuleEvidence = {
  source: '本项目计划书附录 B「反向清单」（封面更清晰 ✗ / 标题情绪拉满 ✗ / 标题党 ✗ / 堆量 ✗）',
  level: 'C',
};

/** 强情绪词表（自定义，C 级）。用于把 Cui et al. 的结论落到可执行检查上。 */
const EMOTION_WORDS = [
  '崩溃', '炸裂', '逆天', '离谱', '麻了', '绝望', '天花板', '最强', '封神', '神作',
  '震撼', '笑死', '赢麻', '暴打', '无语', '气死', '破防', '裂开', '离谱到家', '哭了',
];

/** 标题党/情绪拉满词表（自定义，C 级）。附录 B 反向清单里明确列为无效做法。 */
const CLICKBAIT_WORDS = [
  '震惊', '速看', '不转不是', '99%的人', '99%的人不知道', '揭秘', '惊呆', '不看后悔', '史上最',
];

// ───────────────────────── 工具函数 ─────────────────────────

export function normalizePlatform(raw: unknown): PlatformId | null {
  const v = String(raw ?? '').trim().toLowerCase();
  if (v === 'bilibili' || v === 'b站' || v === '哔哩哔哩') return 'bilibili';
  if (v === 'douyin' || v === '抖音') return 'douyin';
  return null;
}

function hitWords(text: string, words: string[]): string[] {
  const hits: string[] = [];
  for (const w of words) {
    if (text.includes(w)) hits.push(w);
  }
  return hits;
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ───────────────────────── 各规则 ─────────────────────────

function durationAdvice(platform: PlatformId, durationSec?: number): DurationAdvice {
  const target = PLATFORM_DURATION_TARGET[platform];
  const label = PLATFORM_LABEL[platform];

  if (platform === 'bilibili') {
    const base: DurationAdvice = {
      target: target.text,
      targetSec: [target.min, target.max],
      status: 'info',
      detail: `${label}前台计的是「播放分钟数」，不是播放次数——所以把时长做够才有可累积的量。建议 ${target.text}。`,
      evidence: EV_CHEN,
    };
    if (durationSec === undefined) {
      return { ...base, status: 'info', detail: `${base.detail}（脚本还没填分镜时长，暂时无法判断）` };
    }
    if (durationSec < target.min) {
      return {
        ...base,
        status: 'warn',
        detail: `当前 ${Math.round(durationSec / 60 * 10) / 10} 分钟，比建议的 ${target.text} 短：${label}按播放分钟数计权，太短的内容很难积累播放时长。`,
        hint: '要么加厚内容（多给具体信息/过程），要么把这条改投抖音的短版本。',
      };
    }
    if (durationSec > target.max) {
      return {
        ...base,
        status: 'warn',
        detail: `当前 ${Math.round(durationSec / 60 * 10) / 10} 分钟，超出建议的 ${target.text}：注意中段信息密度，别让观众掉队。`,
        hint: '检查第 1–3 分钟是否还在给新信息，否则考虑拆成 2 条。',
      };
    }
    return { ...base, status: 'pass', detail: `当前 ${Math.round(durationSec / 60 * 10) / 10} 分钟，落在 ${label}的建议区间 ${target.text}。` };
  }

  // 抖音
  const base: DurationAdvice = {
    target: target.text,
    targetSec: [target.min, target.max],
    status: 'info',
    detail: `抖音算的是完播率——时长越长，完播率门槛越难过。建议 ${target.text}。`,
    evidence: EV_COMPLETION,
    completionReference: {
      text: '15 秒 >45% / 30 秒 >25% / 1–3 分钟 >10% / 超过 3 分钟 >5%',
      evidence: EV_COMPLETION,
    },
  };
  if (durationSec === undefined) {
    return { ...base, status: 'info', detail: `${base.detail}（脚本还没填分镜时长，暂时无法判断）` };
  }
  if (durationSec < target.min) {
    return { ...base, status: 'info', detail: `当前 ${durationSec} 秒，比建议的 ${target.text} 还短：完播率门槛最低，但信息量也最容易不够。` };
  }
  if (durationSec <= target.max) {
    return { ...base, status: 'pass', detail: `当前 ${durationSec} 秒，落在抖音的建议区间 ${target.text}（完播率参考线 >10%）。` };
  }
  return {
    ...base,
    status: 'warn',
    detail: `当前 ${Math.round(durationSec / 60 * 10) / 10} 分钟，超出抖音的建议区间 ${target.text}：完播率门槛会跳到 >5% 那一档。`,
    hint: '建议按「一个钩子一条」拆成 2–3 条：B站那条继续做长，抖音这条只留最强的那一段。',
  };
}

function titleQuestionRule(title: string): PlatformRule {
  if (!title.trim()) {
    return {
      id: 'title-question',
      label: '标题：疑问句',
      status: 'info',
      detail: '还没填视频标题，无法判断。',
      evidence: EV_HE,
    };
  }
  const isQuestion = /[?？]/.test(title);
  return {
    id: 'title-question',
    label: '标题：疑问句',
    status: isQuestion ? 'pass' : 'info',
    detail: isQuestion
      ? '标题是疑问句。研究显示疑问句标题对点击有正向影响（B站，同行评审）。'
      : '标题不是疑问句。同一条研究里疑问句标题的点击表现更好，可以试一版问句标题做对比。',
    hint: isQuestion ? undefined : '改成问句试试，但不要为了问而问——问题和内容要真的对得上。',
    evidence: EV_HE,
  };
}

function titleEmotionRule(title: string): PlatformRule {
  const hits = hitWords(title, EMOTION_WORDS);
  if (!title.trim()) {
    return { id: 'title-emotion', label: '标题：强情绪词', status: 'info', detail: '还没填视频标题，无法判断。', evidence: EV_CUI };
  }
  return {
    id: 'title-emotion',
    label: '标题：强情绪词',
    status: hits.length ? 'fail' : 'pass',
    detail: hits.length
      ? `标题里出现强情绪词：${hits.join('、')}。同一份研究显示——缩略图强情绪提升播放，但标题文字强情绪反而有负向影响。`
      : '标题没有命中强情绪词。研究显示标题文字堆情绪是负向的，保持现在这样。',
    hint: hits.length ? '把情绪放到封面上，标题保留信息量。' : undefined,
    evidence: EV_CUI,
  };
}

function coverEmotionRule(coverText: string): PlatformRule {
  const hits = hitWords(coverText, EMOTION_WORDS);
  if (!coverText.trim()) {
    return {
      id: 'cover-emotion',
      label: '封面文案：强情绪',
      status: 'info',
      detail: '还没填封面文案。该项规则需要一个封面文案才能判断——不填就不会给结论。',
      hint: '填上封面上要写的那几个字（封面文案，不是标题），才能检查这一条。',
      evidence: EV_CUI,
    };
  }
  return {
    id: 'cover-emotion',
    label: '封面文案：强情绪',
    status: hits.length ? 'pass' : 'info',
    detail: hits.length
      ? `封面文案命中强情绪词：${hits.join('、')}。研究结论是缩略图强情绪（正向或负向都算）会带来更多播放。`
      : '封面文案没有命中强情绪词。研究里情绪更强的封面拿到更多播放，可以考虑把情绪放到封面而不是标题。',
    evidence: EV_CUI,
  };
}

function coverPixelsRule(): PlatformRule {
  return {
    id: 'cover-pixels',
    label: '封面图像：对比度/亮度',
    status: 'info',
    detail:
      '这条规则无法自动检查：本工具只读文案，不分析图像像素。而研究显示封面的「图像质量」不显著，「色彩/亮度」才显著——请自己确认封面在手机小图下是否还看得清。',
    evidence: EV_HE,
  };
}

function ctrRule(ctr?: number): PlatformRule {
  if (ctr === undefined) {
    return {
      id: 'ctr-reference',
      label: '封面点击率（CTR）',
      status: 'info',
      detail: '没有填 CTR 就不给结论（不编数字）。如果后台有封面点击率，填进来可以对照公开区间。',
      evidence: EV_CTR,
    };
  }
  if (ctr < 2) {
    return {
      id: 'ctr-reference',
      label: '封面点击率（CTR）',
      status: 'fail',
      detail: `CTR ${ctr}% 低于 YouTube 官方给的 2% 下限：按官方口径属于「封面/标题该重做」。`,
      hint: '一次只改一个变量（先换封面，再改标题），否则分不清是哪个起的作用。',
      evidence: EV_CTR,
    };
  }
  if (ctr > 10) {
    return {
      id: 'ctr-reference',
      label: '封面点击率（CTR）',
      status: 'info',
      detail: `CTR ${ctr}% 高于 YouTube 官方的 10% 优秀线。注意：CTR 随曝光扩大自然下降，属于正常现象。`,
      evidence: EV_CTR,
    };
  }
  return {
    id: 'ctr-reference',
    label: '封面点击率（CTR）',
    status: 'pass',
    detail: `CTR ${ctr}% 落在 YouTube 官方的健康区间 2–10%（4–6% 为平均）。`,
    evidence: EV_CTR,
  };
}

function cadenceRule(postsPerWeek?: number): PlatformRule {
  if (postsPerWeek === undefined) {
    return {
      id: 'cadence',
      label: '更新节奏',
      status: 'info',
      detail: '没有填计划更新频率，跳过。18,000 频道研究结论是「每周 1–2 条并稳定保持」最佳。',
      evidence: EV_CADENCE,
    };
  }
  if (postsPerWeek > 2) {
    return {
      id: 'cadence',
      label: '更新节奏',
      status: 'warn',
      detail: `每周 ${postsPerWeek} 条高于研究里的 1–2 条：20,000 频道研究显示「更多视频 ≠ 更多播放」，堆量不会带动存量。`,
      hint: '把精力放在单条质量上；如果是为了测试选题，可以只在固定栏目里加速。',
      evidence: EV_MORE_VIDEOS,
    };
  }
  if (postsPerWeek < 1) {
    return {
      id: 'cadence',
      label: '更新节奏',
      status: 'warn',
      detail: `每周 ${postsPerWeek} 条：研究强调「稳定保持」本身有价值，节奏太稀会让算法拿不到稳定信号。`,
      evidence: EV_CADENCE,
    };
  }
  return {
    id: 'cadence',
    label: '更新节奏',
    status: 'pass',
    detail: `每周 ${postsPerWeek} 条，符合 18,000 频道研究里的 1–2 条/周且稳定保持。`,
    evidence: EV_CADENCE,
  };
}

function completionRule(platform: PlatformId, durationSec: number | undefined, completionRate?: number): PlatformRule {
  if (platform !== 'douyin') {
    return {
      id: 'completion-rate',
      label: '完播率',
      status: 'info',
      detail: '完播率分档是抖音的口径；B站按播放分钟数计权（见时长建议），不套用这一条。',
      evidence: EV_CHEN,
    };
  }
  if (completionRate === undefined) {
    return {
      id: 'completion-rate',
      label: '完播率',
      status: 'info',
      detail: '没有填完播率就不给结论。参考线：15 秒 >45% / 30 秒 >25% / 1–3 分钟 >10% / 超过 3 分钟 >5%。',
      evidence: EV_COMPLETION,
    };
  }
  const threshold = durationSec === undefined ? 10 : durationSec <= 15 ? 45 : durationSec <= 30 ? 25 : durationSec <= 180 ? 10 : 5;
  return {
    id: 'completion-rate',
    label: '完播率',
    status: completionRate >= threshold ? 'pass' : 'warn',
    detail: `完播率 ${completionRate}%，对照本时长档的参考线 ${threshold}%：${completionRate >= threshold ? '达标' : '未达标'}。`,
    hint: completionRate >= threshold ? undefined : '先看前 3 秒是否抓人；如果是中段断崖，问题通常在 30 秒–1 分钟的内容密度。',
    evidence: EV_COMPLETION,
  };
}

function clickbaitRule(title: string, coverText: string): PlatformRule {
  const hits = hitWords(`${title} ${coverText}`, CLICKBAIT_WORDS);
  if (hits.length === 0) {
    return {
      id: 'reverse-list',
      label: '反向清单（标题党 / 情绪拉满）',
      status: 'pass',
      detail: '标题与封面文案都没有命中反向清单里的词。',
      evidence: EV_REVERSE,
    };
  }
  return {
    id: 'reverse-list',
    label: '反向清单（标题党 / 情绪拉满）',
    status: 'warn',
    detail: `命中反向清单里的词：${hits.join('、')}。这些做法在证据表里被列为「看似有效实则无效」。`,
    hint: '把悬念做在内容里，而不是把词堆在标题上。',
    evidence: EV_REVERSE,
  };
}

function platformCoherenceRule(platform: PlatformId): PlatformRule {
  return {
    id: 'platform-coherence',
    label: '跨平台口径',
    status: 'info',
    detail:
      platform === 'bilibili'
        ? 'B站计播放分钟数：时长与内容厚度是核心变量。把同一脚本直接搬到抖音（按完播率）通常会吃亏，要单独剪。'
        : '抖音计完播率：节奏与密度是核心变量。把 B站的长视频直接搬过来通常会掉完播，需要重剪。',
    evidence: EV_CHEN,
  };
}

// ───────────────────────── 主入口 ─────────────────────────

export function checkPlatform(input: PlatformCheckInput): PlatformCheck {
  const platform = normalizePlatform(input.platform) || 'bilibili';
  const title = (input.title || '').trim();
  const coverText = (input.coverText || '').trim();
  const durationSec = num(input.durationSec);
  const ctr = num(input.ctr);
  const completionRate = num(input.completionRate);
  const postsPerWeek = num(input.postsPerWeek);

  const rules: PlatformRule[] = [
    titleQuestionRule(title),
    titleEmotionRule(title),
    coverEmotionRule(coverText),
    coverPixelsRule(),
    ctrRule(ctr),
    cadenceRule(postsPerWeek),
    completionRule(platform, durationSec, completionRate),
    clickbaitRule(title, coverText),
    platformCoherenceRule(platform),
  ];

  const summary = {
    total: rules.length,
    pass: rules.filter((r) => r.status === 'pass').length,
    warn: rules.filter((r) => r.status === 'warn').length,
    fail: rules.filter((r) => r.status === 'fail').length,
    info: rules.filter((r) => r.status === 'info').length,
    /** 带出处的规则数：必须等于 total（每条规则都有出处，UI 才有东西可显示） */
    sourced: rules.filter((r) => !!r.evidence.source).length,
  };

  return {
    platform,
    platformLabel: PLATFORM_LABEL[platform],
    engine: RULE_ENGINE_ID,
    durationAdvice: durationAdvice(platform, durationSec),
    rules,
    summary,
    checkedAt: Date.now(),
    disclaimer:
      '以上全部是「相关性结论 + 本项目自定义阈值」，不是平台算法口径。游戏区没有公开可信的完播率/互动率基准（计划书附录 B 列为 C 级），任何比率都只是参考线，不能当 KPI。',
  };
}

/** 供 UI 标注：每条规则的证据等级分布 */
export function evidenceLevels(): EvidenceLevel[] {
  return ['A', 'B', 'C'];
}

/** CTR 参考区间（YouTube 官方口径），导出以便 UI 文案与之保持单一事实来源 */
export const CTR_HEALTHY_RANGE = { min: 2, max: 10, average: [4, 6] as [number, number] };
