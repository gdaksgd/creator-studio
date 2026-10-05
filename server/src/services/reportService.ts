// ============================================================
//  分析报告服务（M3）
//
//  把基准线数据变成一件可导出的作品：《B站游戏区内容分析报告》。
//  计划书 M3 要求 4 个分析维度 + 针对自己选题的建议：
//    ① 品类分布与竞争强度（来自 M2 基准线）
//    ② TOP 作品的标题模式（疑问句占比 / 长度分布 / 关键词）
//    ③ 时长–互动率关系
//    ④ 发布时段分布
//    ⑤ 对自己选题的建议
//
//  ★ 数据诚实原则（计划书第 3 节第 4 条）在代码里的落点：
//    1. 报告里每个数字都是 ReportMetric —— 类型上强制携带 ReportBasis
//       （来源 + 样本量 + 时间窗 + 统计口径），构造不出一个「裸数字」；
//    2. Markdown 导出走同一棵 ReportMetric 树，渲染函数只会打印 display + basis，
//       所以导出内容结构性地不可能出现无出处的数字；渲染前还会跑一次
//       validateReport()，把「缺出处的数字」计数写进 selfCheck，供冒烟测试断言；
//    3. 样本量不达标的维度不出数字，而是进 unavailable 并说明原因；
//    4. 相关性不写成因果：热门榜是「已经火了的视频」，口径声明里明说这一点，
//       所以「发布时段分布」不会被包装成「最佳发布时间」。
// ============================================================

import { CATEGORIES } from '../config/categories.js';
import {
  POPULAR_SOURCE_LABEL,
  SEARCH_SOURCE_LABEL,
  SEARCH_WINDOW_DAYS,
} from './collectors/bilibiliBenchmarkCollector.js';
import {
  GAME_PARTITIONS,
  getReportPool,
  isCollecting,
  lastCollectError,
  listSamples,
  quantile,
  searchPoolSizeByGroup,
  type PopularPoolItem,
  type SearchPoolItem,
} from './benchmarkService.js';
import type {
  BenchmarkSample,
  CompetitionIntensity,
  GameIndustryReport,
  ReportBasis,
  ReportCategoryLine,
  ReportDurationBucket,
  ReportDurationCurve,
  ReportEvidence,
  ReportKeyword,
  ReportMetric,
  ReportPublishTiming,
  ReportSelfCheck,
  ReportSuggestion,
  ReportTimingBucket,
  ReportTitlePattern,
} from '../types.js';

// ─── 门槛（低于门槛就不出数字，而不是出一个看起来很像样的假数字） ───

/** 时长分桶判定「最优桶」要求的最小视频数：低于 10 条的桶可以展示，但不足以宣称最优 */
const MIN_CURVE_BUCKET = 10;
/** 标题/时段/关键词统计的最低样本量 */
const MIN_TITLE_SAMPLE = 20;
const MIN_TIMING_SAMPLE = 20;
/** 分类目给建议的最低样本量（与 M2 的品类门槛一致） */
const MIN_CATEGORY_SAMPLE = 15;
/** 头部集中度里「头部」的定义：播放量前 10% */
const HEAD_SHARE = 0.1;
/** 竞争强度分档阈值（本报告自定义，口径写在 basis.method 里） */
const INTENSITY_HIGH = 0.6;
const INTENSITY_MEDIUM = 0.4;

/** 关键词统计的停用词：只去掉平台套话，保留「攻略 / 解说 / 实况」这类能说明内容形态的词 */
const STOPWORDS = new Set([
  '游戏', '视频', '这个', '那个', '什么', '怎么', '我们', '你们', '他们', '自己', '可以', '没有',
  '就是', '不是', '还是', '但是', '因为', '所以', '以及', '还有', '真的', '感觉', '现在', '已经',
  '一个', '两个', '这样', '时候', '知道', '觉得', '这些', '那些', '非常', '超级', '官方', '全集',
  '合集', '最新', '高清', '中文', '字幕', '原版', '完整版', '小时的', '一起来', '看看', '一下',
]);

// ─── 格式化 ────────────────────────────────────────────────

const wan = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(Math.round(n)));
const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const fmtSec = (s: number) => {
  const sec = Math.max(0, Math.round(s));
  if (sec < 60) return `${sec} 秒`;
  const m = Math.floor(sec / 60);
  const rest = sec % 60;
  if (m < 60) return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
};

function display(value: number, unit: ReportMetric['unit']): string {
  switch (unit) {
    case 'views':
      return wan(value);
    case 'rate':
      return pct(value);
    case 'ratio':
      return `${(value * 100).toFixed(1)}%`;
    case 'seconds':
      return fmtSec(value);
    case 'chars':
      return `${Math.round(value)} 字`;
    case 'count':
      return String(Math.round(value));
  }
}

interface BasisInput {
  source: ReportBasis['source'];
  sourceLabel: string;
  sampleSize: number;
  windowDays: number | null;
  collectedAt: number;
  method: string;
}

function basis(b: BasisInput): ReportBasis {
  return { ...b };
}

function metric(label: string, value: number, unit: ReportMetric['unit'], b: ReportBasis): ReportMetric {
  return { label, value, display: display(value, unit), unit, basis: b };
}

/** 升序分位（传入可为乱序） */
function quantileOf(values: number[], p: number): number {
  return quantile([...values].sort((a, b) => a - b), p);
}

function median(values: number[]): number {
  return quantileOf(values, 0.5);
}

/** 比率中位：分母为 0 的条目不参与，避免造出「0% 互动率」这种假数字 */
function medianRate(items: Array<{ num: number; den: number }>): number | null {
  const rates = items.filter((i) => i.den > 0).map((i) => i.num / i.den);
  if (!rates.length) return null;
  return median(rates);
}

// ─── 各维度计算 ────────────────────────────────────────────

const QUESTIONS = /[?？]/;

/** 标题里的问号视为疑问句。口径写死在报告里，避免「感觉像疑问句」这种模糊标准。 */
function isQuestion(title: string): boolean {
  return QUESTIONS.test(title);
}

const PUNCT = /[【】\[\]（）()《》〈〉「」『』—–\-_/\\|:：;；,，.。!！~～"'“”‘’*+&%$#@^]/g;

/** 关键词最长长度：再长就成了整句回声，而不是「这批标题在说什么」 */
const MAX_KEYWORD_LEN = 6;
/** 一个短词被一个长词「覆盖」的条件：长词至少出现这么多次，且能解释短词一半以上的出现 */
const COVER_MIN_COUNT = 3;

/**
 * 从标题里抽高频内容词。
 * ★ 没有分词词典（项目约束：不新增运行时依赖），所以：
 *   1. 先统计所有 ≤ MAX_KEYWORD_LEN 字的中文子串频次；
 *   2. 再取「极大重复子串」——每个起点尽量向右延长，只要频次仍 ≥ 2，
 *      这样「我的世界」不会被切成「我的」「世界」两条；
 *   3. 去掉被更长词覆盖的短词（长词出现 ≥ 3 次且能解释短词一半以上出现）。
 * 局限会原样写进报告的 caveat，不假装这是语义主题分析。
 */
function extractKeywords(titles: string[], limit = 15): ReportKeyword[] {
  const texts = titles.map((t) => String(t).replace(PUNCT, ' '));
  const cnCount = new Map<string, number>();
  const enCount = new Map<string, number>();

  for (const text of texts) {
    for (const run of text.match(/[\u4e00-\u9fa5]+/g) ?? []) {
      const maxLen = Math.min(MAX_KEYWORD_LEN, run.length);
      for (let n = 2; n <= maxLen; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const w = run.slice(i, i + n);
          cnCount.set(w, (cnCount.get(w) ?? 0) + 1);
        }
      }
    }
    for (const w of text.match(/[A-Za-z][A-Za-z0-9.]{2,}/g) ?? []) {
      const word = w.toLowerCase();
      if (STOPWORDS.has(word)) continue;
      enCount.set(word, (enCount.get(word) ?? 0) + 1);
    }
  }

  const maximal = new Set<string>();
  for (const text of texts) {
    for (const run of text.match(/[\u4e00-\u9fa5]+/g) ?? []) {
      for (let i = 0; i < run.length; i++) {
        let best = '';
        for (let n = 2; n <= Math.min(MAX_KEYWORD_LEN, run.length - i); n++) {
          const w = run.slice(i, i + n);
          if ((cnCount.get(w) ?? 0) < 2) break;
          if (STOPWORDS.has(w)) continue;
          best = w;
        }
        if (best) maximal.add(best);
      }
    }
  }

  const candidates: Array<{ word: string; count: number }> = [
    ...[...maximal].map((word) => ({ word, count: cnCount.get(word) ?? 0 })),
    ...[...enCount.entries()].filter(([, c]) => c >= 2).map(([word, count]) => ({ word, count })),
  ];

  const kept = candidates.filter(
    (a) =>
      !candidates.some(
        (b) =>
          b.word !== a.word &&
          b.word.length > a.word.length &&
          b.word.includes(a.word) &&
          b.count >= COVER_MIN_COUNT &&
          b.count * 2 >= a.count,
      ),
  );

  kept.sort((a, b) => b.count - a.count || b.word.length - a.word.length || a.word.localeCompare(b.word));

  const sampleSize = Math.max(1, titles.length);
  return kept.slice(0, limit).map((k) => ({ word: k.word, count: k.count, ratio: k.count / sampleSize }));
}

const DURATION_BUCKETS: Array<{ label: string; minSec: number; maxSec: number | null }> = [
  { label: '1 分钟以内', minSec: 0, maxSec: 60 },
  { label: '1–3 分钟', minSec: 60, maxSec: 180 },
  { label: '3–5 分钟', minSec: 180, maxSec: 300 },
  { label: '5–10 分钟', minSec: 300, maxSec: 600 },
  { label: '10–30 分钟', minSec: 600, maxSec: 1800 },
  { label: '30 分钟以上', minSec: 1800, maxSec: null },
];

/** Asia/Shanghai 无夏令时，固定 +8；显式写出来，避免依赖服务器时区 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function hourOf(pubdateSec: number): number {
  return new Date(pubdateSec * 1000 + TZ_OFFSET_MS).getUTCHours();
}

/** 播放量前 10% 的视频占样本总播放的比例 */
function concentration(viewDistributionAsc: number[]): number {
  const sorted = [...viewDistributionAsc].sort((a, b) => b - a);
  const total = sorted.reduce((s, v) => s + v, 0);
  if (!sorted.length || total <= 0) return 0;
  const headCount = Math.max(1, Math.round(sorted.length * HEAD_SHARE));
  const headSum = sorted.slice(0, headCount).reduce((s, v) => s + v, 0);
  return headSum / total;
}

function intensityOf(value: number): CompetitionIntensity {
  if (value >= INTENSITY_HIGH) return 'high';
  if (value >= INTENSITY_MEDIUM) return 'medium';
  return 'low';
}

const INTENSITY_LABEL: Record<CompetitionIntensity, string> = {
  high: '高（播放高度集中于少数视频）',
  medium: '中',
  low: '低（播放较分散）',
};

// ─── 主体 ─────────────────────────────────────────────────

function notReady(reason: string, days: number): GameIndustryReport {
  const now = Date.now();
  const none = basis({
    source: 'bilibili-popular',
    sourceLabel: '暂无可用样本',
    sampleSize: 0,
    windowDays: null,
    collectedAt: now,
    method: '未采集到样本，本报告不产出任何数字',
  });
  return {
    ready: false,
    error: reason,
    generatedAt: now,
    days,
    scope: none,
    poolSize: 0,
    categories: [],
    titlePattern: {
      basis: none,
      questionRatio: metric('疑问句标题占比', 0, 'ratio', none),
      lengthP25: metric('标题字数 P25', 0, 'chars', none),
      lengthMedian: metric('标题字数中位', 0, 'chars', none),
      lengthP75: metric('标题字数 P75', 0, 'chars', none),
      lengthBuckets: [],
      keywords: [],
      caveat: '样本不足，未做标题统计。',
    },
    durationCurve: { basis: none, buckets: [], bestBucket: null, trend: 'unknown', caveat: '样本不足，未做时长统计。' },
    publishTiming: { basis: none, timezone: 'Asia/Shanghai (UTC+8)', buckets: [], topHours: [], caveat: '样本不足，未做时段统计。' },
    suggestions: [],
    evidence: EVIDENCE,
    unavailable: [reason],
    selfCheck: { metricCount: 0, unbackedMetricCount: 0 },
  };
}

/** 报告引用的外部证据（与计划书附录 B 一致，等级原样保留） */
const EVIDENCE: ReportEvidence[] = [
  {
    claim: 'B站自 2023-06 起前台播放量改为「播放分钟数」；2023Q1 UGC 中长视频占播放量 70%',
    origin: 'B站 CEO 陈睿公开表态',
    grade: 'A',
    usedIn: '时长–互动率维度：B站的收益口径与短视频平台不同，不能照搬抖音的节奏结论',
  },
  {
    claim: 'B站上疑问句标题、内容形象显著影响点击；图像质量与粉丝量不显著',
    origin: '贺一、张玮锋《科普研究》2023,18(6):41-52',
    grade: 'A',
    usedIn: '标题模式维度：只报告疑问句占比这个事实，不据此断言因果',
  },
  {
    claim: '缩略图强情绪提升播放，但标题文字强情绪反而有负向影响；正面标题优于负面标题',
    origin: 'Cui, Chung, Peng & Wang (2024), Journal of Business Research 183:114849，样本 16,215',
    grade: 'A',
    usedIn: '标题与选题建议：提醒不要用堆情绪词的方式换点击',
  },
  {
    claim: '游戏区没有公开可信的完播率 / 互动率 / 涨粉率基准，网传数值均无法核实',
    origin: '未找到官方来源（计划书附录 B 标为 C 级证据）',
    grade: 'C',
    usedIn: '全文所有比率都只是「本报告自采样水位」，不是行业标准，不可当 KPI',
  },
];

/**
 * 生成《B站游戏区内容分析报告》。
 * 数据全部来自基准线采集的原始样本池；缺池（旧缓存）时返回 ready=false，
 * 由路由告诉前端「正在补采」，而不是拿空池算出一堆 0。
 */
export function buildGameIndustryReport(days = SEARCH_WINDOW_DAYS): GameIndustryReport {
  const pool = getReportPool();
  if (!pool) {
    const failed = lastCollectError();
    return notReady(
      isCollecting()
        ? '原始样本池正在重新采集（首次约 20 秒），请稍后刷新'
        : failed
          ? `当前缓存缺少原始样本条目（由旧版本生成），重新采集也失败了：${failed}`
          : '当前缓存缺少原始样本条目（由旧版本生成），已触发重新采集，请稍后刷新',
      days,
    );
  }

  const { popular, search, collectedAt } = pool;
  const gamePool = popular.filter((i) => GAME_PARTITIONS.includes(i.tname));
  const unavailable: string[] = [];

  const scopeBasis = basis({
    source: 'bilibili-popular',
    sourceLabel: `${POPULAR_SOURCE_LABEL} · 游戏子分区`,
    sampleSize: gamePool.length,
    windowDays: null,
    collectedAt,
    method: '热门榜当前快照（不是固定时间窗），且只覆盖「已经火了」的视频，属于头部样本，不能外推全体发布分布',
  });

  // ① 品类分布与竞争强度
  const samples = listSamples();
  const groupSize = searchPoolSizeByGroup();
  const searchPoolByGroup = new Map<string, SearchPoolItem[]>();
  for (const item of search) {
    const list = searchPoolByGroup.get(item.group) ?? [];
    list.push(item);
    searchPoolByGroup.set(item.group, list);
  }

  const categories: ReportCategoryLine[] = [];
  for (const cat of CATEGORIES) {
    const sample = samples.find((s) => s.scope === 'category' && s.key === cat.id);
    const items = searchPoolByGroup.get(cat.id) ?? [];
    if (!sample || !items.length) {
      const n = groupSize[cat.id] ?? 0;
      unavailable.push(
        `品类「${cat.label}」样本不足（当前 ${n} 条，需要 ≥ ${MIN_CATEGORY_SAMPLE} 条）——不给结论，也不给占位数字`,
      );
      continue;
    }
    categories.push(buildCategoryLine(cat.id, cat.label, sample, items, collectedAt));
  }
  categories.sort((a, b) => b.viewMedian.value - a.viewMedian.value);

  // ② 标题模式（口径：游戏子分区热门榜条目）
  const titlePattern = buildTitlePattern(gamePool, scopeBasis, unavailable);
  // ③ 时长–互动率
  const durationCurve = buildDurationCurve(gamePool, scopeBasis, unavailable);
  // ④ 发布时段
  const publishTiming = buildPublishTiming(gamePool, scopeBasis, unavailable);

  // ⑤ 建议（每条引用数据的都带 basis；纯方法论建议不带）
  const suggestions = buildSuggestions(categories, durationCurve, titlePattern, publishTiming, scopeBasis);

  const report: GameIndustryReport = {
    ready: true,
    generatedAt: Date.now(),
    days,
    scope: scopeBasis,
    poolSize: popular.length + search.length,
    categories,
    titlePattern,
    durationCurve,
    publishTiming,
    suggestions,
    evidence: EVIDENCE,
    unavailable,
    selfCheck: { metricCount: 0, unbackedMetricCount: 0 },
  };

  const check = validateReport(report);
  report.selfCheck = check;
  return report;
}

function buildCategoryLine(
  key: string,
  label: string,
  sample: BenchmarkSample,
  items: SearchPoolItem[],
  collectedAt: number,
): ReportCategoryLine {
  const windowText = sample.windowDays === null ? '榜单快照' : `近 ${sample.windowDays} 天`;
  const b = (method: string): ReportBasis =>
    basis({
      source: sample.source,
      sourceLabel: `${sample.sourceLabel}（${windowText}）`,
      sampleSize: sample.sampleSize,
      windowDays: sample.windowDays,
      collectedAt,
      method,
    });

  const views = sample.viewDistribution;
  const conc = concentration(views);
  const dur = items.map((i) => i.duration).filter((d) => d > 0);
  const questions = items.filter((i) => isQuestion(i.title)).length;

  return {
    key,
    label,
    sampleSize: sample.sampleSize,
    windowDays: sample.windowDays,
    sourceLabel: sample.sourceLabel,
    viewMedian: metric('播放中位', quantileOf(views, 0.5), 'views', b('样本播放量中位数')),
    viewP90: metric('播放 P90', quantileOf(views, 0.9), 'views', b('样本播放量第 90 百分位')),
    likeRateMedian: sample.rates.like
      ? metric('点赞率中位', sample.rates.like.median, 'rate', b('各条视频 点赞数 ÷ 播放量，再取中位'))
      : null,
    concentration: metric(
      '头部集中度',
      conc,
      'ratio',
      b(`播放量前 ${HEAD_SHARE * 100}% 的视频占样本总播放的比例（含 P90/P25 口径的同一批样本）`),
    ),
    intensity: intensityOf(conc),
    questionRatio: metric(
      '疑问句标题占比',
      questions / Math.max(1, items.length),
      'ratio',
      b('标题含问号（? 或 ？）即计为疑问句'),
    ),
    durationMedian: dur.length
      ? metric('时长中位', median(dur), 'seconds', b('样本视频时长（秒）的中位数，已剔除时长为 0 的条目'))
      : metric('时长中位', 0, 'seconds', b('该样本没有可用的时长字段')),
    unavailable: sample.unavailable,
  };
}

function buildTitlePattern(
  gamePool: PopularPoolItem[],
  scopeBasis: ReportBasis,
  unavailable: string[],
): ReportTitlePattern {
  const titles = gamePool.map((i) => i.title).filter((t) => t.trim().length > 0);
  if (titles.length < MIN_TITLE_SAMPLE) {
    const msg = `标题模式：游戏子分区热门榜样本仅 ${titles.length} 条（需要 ≥ ${MIN_TITLE_SAMPLE} 条），本维度不出数字`;
    unavailable.push(msg);
    return {
      basis: scopeBasis,
      questionRatio: metric('疑问句标题占比', 0, 'ratio', scopeBasis),
      lengthP25: metric('标题字数 P25', 0, 'chars', scopeBasis),
      lengthMedian: metric('标题字数中位', 0, 'chars', scopeBasis),
      lengthP75: metric('标题字数 P75', 0, 'chars', scopeBasis),
      lengthBuckets: [],
      keywords: [],
      caveat: msg,
    };
  }

  const lengths = titles.map((t) => t.trim().length);
  const questions = titles.filter(isQuestion).length;
  const b = (method: string) => ({ ...scopeBasis, method });

  const bucketDefs = [
    { label: '10 字以内', min: 0, max: 10 },
    { label: '11–20 字', min: 11, max: 20 },
    { label: '21–30 字', min: 21, max: 30 },
    { label: '31 字以上', min: 31, max: Number.POSITIVE_INFINITY },
  ];
  const lengthBuckets = bucketDefs.map((d) => {
    const count = lengths.filter((l) => l >= d.min && l <= d.max).length;
    return { label: d.label, count, ratio: count / titles.length };
  });

  return {
    basis: scopeBasis,
    questionRatio: metric('疑问句标题占比', questions / titles.length, 'ratio', b('标题含问号（? 或 ？）即计为疑问句')),
    lengthP25: metric('标题字数 P25', quantileOf(lengths, 0.25), 'chars', b('标题字符数（含标点，不含首尾空格）第 25 百分位')),
    lengthMedian: metric('标题字数中位', median(lengths), 'chars', b('标题字符数中位数')),
    lengthP75: metric('标题字数 P75', quantileOf(lengths, 0.75), 'chars', b('标题字符数第 75 百分位')),
    lengthBuckets,
    keywords: extractKeywords(titles),
    caveat:
      '关键词用中文「极大重复子串」+ 词频统计得到（最长 6 字；无分词词典，已去停用词，并去掉被更高频长词覆盖的短词），只能说明「这批标题在反复说什么」，不等于语义主题分析。',
  };
}

function buildDurationCurve(
  gamePool: PopularPoolItem[],
  scopeBasis: ReportBasis,
  unavailable: string[],
): ReportDurationCurve {
  const usable = gamePool.filter((i) => i.duration > 0 && i.views > 0);
  if (usable.length < MIN_TITLE_SAMPLE) {
    const msg = `时长–互动率：可同时取到时长与播放的样本仅 ${usable.length} 条（需要 ≥ ${MIN_TITLE_SAMPLE} 条），本维度不出数字`;
    unavailable.push(msg);
    return { basis: scopeBasis, buckets: [], bestBucket: null, trend: 'unknown', caveat: msg };
  }

  const b = (method: string) => ({ ...scopeBasis, method });
  const buckets: ReportDurationBucket[] = DURATION_BUCKETS.map((def) => {
    const inBucket = usable.filter(
      (i) => i.duration >= def.minSec && (def.maxSec === null || i.duration < def.maxSec),
    );
    const likeRate = medianRate(inBucket.map((i) => ({ num: i.likes, den: i.views })));
    return {
      label: def.label,
      minSec: def.minSec,
      maxSec: def.maxSec,
      videoCount: inBucket.length,
      viewMedian: metric(
        '播放中位',
        inBucket.length ? median(inBucket.map((i) => i.views)) : 0,
        'views',
        b(`仅统计时长落在「${def.label}」的视频（${inBucket.length} 条）的播放中位`),
      ),
      likeRateMedian:
        likeRate === null
          ? null
          : metric(
              '点赞率中位',
              likeRate,
              'rate',
              b(`仅统计时长落在「${def.label}」的视频，各条 点赞数 ÷ 播放量 后取中位`),
            ),
    };
  });

  const eligible = buckets.filter((x) => x.videoCount >= MIN_CURVE_BUCKET && x.likeRateMedian);
  const best = eligible.length
    ? eligible.reduce((a, b2) => ((b2.likeRateMedian as ReportMetric).value > (a.likeRateMedian as ReportMetric).value ? b2 : a))
    : null;

  // 「B站奖励看得久」是别人的说法，这里只让数据说方向：比较达标桶里最短与最长两端的点赞率
  let trend: ReportDurationCurve['trend'] = 'unknown';
  if (eligible.length >= 2) {
    const first = (eligible[0].likeRateMedian as ReportMetric).value;
    const last = (eligible[eligible.length - 1].likeRateMedian as ReportMetric).value;
    const base = Math.min(first, last);
    const diff = base > 0 ? (last - first) / base : 0;
    trend = Math.abs(diff) < 0.1 ? 'flat' : diff < 0 ? 'decreasing' : 'increasing';
  }

  return {
    basis: scopeBasis,
    buckets,
    bestBucket: best?.label ?? null,
    trend,
    caveat: `「点赞率最高的桶」要求视频数 ≥ ${MIN_CURVE_BUCKET} 条；这只是同一批热门视频的横截面对比，不是「把视频做长就能提升互动」的因果结论。`,
  };
}

function buildPublishTiming(
  gamePool: PopularPoolItem[],
  scopeBasis: ReportBasis,
  unavailable: string[],
): ReportPublishTiming {
  const caveat =
    '热门榜只收录已经火起来的视频，发布时段分布因此有偏（夜间发布、周末发布都会被稀释或放大），只能当线索，不能当「最佳发布时间」。';
  const usable = gamePool.filter((i) => i.pubdate > 0);
  if (usable.length < MIN_TIMING_SAMPLE) {
    const msg = `发布时段：带有效发布时间的样本仅 ${usable.length} 条（需要 ≥ ${MIN_TIMING_SAMPLE} 条），本维度不出数字`;
    unavailable.push(msg);
    return { basis: scopeBasis, timezone: 'Asia/Shanghai (UTC+8)', buckets: [], topHours: [], caveat: msg };
  }

  const buckets: ReportTimingBucket[] = Array.from({ length: 24 }, (_, hour) => {
    const inHour = usable.filter((i) => hourOf(i.pubdate) === hour);
    return {
      hour,
      videoCount: inHour.length,
      viewMedian: inHour.length ? Math.round(median(inHour.map((i) => i.views))) : 0,
    };
  });

  const nonEmpty = buckets.filter((x) => x.videoCount > 0);
  const topHours = [...nonEmpty]
    .sort((a, b) => b.videoCount - a.videoCount || a.hour - b.hour)
    .slice(0, 3)
    .map((x) => x.hour);

  return {
    basis: { ...scopeBasis, method: '按发布时间（北京时间，UTC+8）落在哪个小时分桶，统计样本条数' },
    timezone: 'Asia/Shanghai (UTC+8)',
    buckets,
    topHours,
    caveat,
  };
}

function buildSuggestions(
  categories: ReportCategoryLine[],
  curve: ReportDurationCurve,
  title: ReportTitlePattern,
  timing: ReportPublishTiming,
  scopeBasis: ReportBasis,
): ReportSuggestion[] {
  const out: ReportSuggestion[] = [];

  const top = categories[0];
  if (top) {
    out.push({
      text: `你现在的品类里，样本播放中位最高的是「${top.label}」：${top.viewMedian.display}。把它当成这个品类当前的「水位线」——低于它不代表失败，但一条视频要在这个品类里跑出来，通常得明显高于它。`,
      basis: top.viewMedian.basis,
    });
  }

  const strongest = [...categories].sort((a, b) => b.concentration.value - a.concentration.value)[0];
  if (strongest) {
    out.push({
      text: `播放最集中的品类是「${strongest.label}」：头部集中度 ${strongest.concentration.display}，即前 ${HEAD_SHARE * 100}% 的视频吃掉了样本里这么大比例的播放。集中度越高，越依赖单条爆款，新号越难靠「稳定更新」慢慢爬。`,
      basis: strongest.concentration.basis,
    });
  }

  const best = curve.buckets.find((x) => x.label === curve.bestBucket);
  if (best && best.likeRateMedian) {
    const maxView = [...curve.buckets].filter((x) => x.videoCount > 0).sort((a, b) => b.viewMedian.value - a.viewMedian.value)[0];
    const sameBucket = !!maxView && maxView.label === best.label;
    const trendText: Record<ReportDurationCurve['trend'], string> = {
      decreasing: '而且样本里时长越长、点赞率越低',
      increasing: '而且样本里时长越长、点赞率越高',
      flat: '各时长区间的点赞率没有明显走势',
      unknown: '样本量不足以判断走势',
    };
    out.push({
      text: `时长–互动率：点赞率中位最高的时长区间是「${best.label}」（${best.likeRateMedian.display}，${best.videoCount} 条样本），${
        trendText[curve.trend]
      }。${
        sameBucket
          ? `播放中位最高的也是同一个区间（${(maxView as ReportDurationBucket).viewMedian.display}）——在这批样本里「更容易被点赞」和「更容易被播放」刚好指向同一档时长。`
          : `而播放中位最高的区间是「${maxView.label}」（${maxView.viewMedian.display}）——「更容易被点赞」和「更容易被播放」在这里不是同一件事，别只拿一个当目标。`
      }`,
      basis: best.likeRateMedian.basis,
    });
  } else if (curve.buckets.length) {
    out.push({
      text: `时长–互动率：没有任何时长区间的样本量达到 ${MIN_CURVE_BUCKET} 条，所以这次不给「最优时长」结论——样本不够就宁可不说。`,
      basis: scopeBasis,
    });
  }

  if (title.keywords.length) {
    const top3 = title.keywords.slice(0, 3).map((k) => `「${k.word}」（${k.count} 条标题出现）`).join('、');
    out.push({
      text: `这批热门标题反复出现的内容词是 ${top3}。疑问句标题占 ${title.questionRatio.display}——B站上疑问句标题对点击有正向影响的结论出自同行评审研究（见文末出处），但这里只报告占比，不据此保证因果。`,
      basis: title.questionRatio.basis,
    });
  }

  if (timing.topHours.length) {
    const hours = timing.topHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' / ');
    out.push({
      text: `样本里发布最集中的时段是 ${hours}（北京时间）。这只是「热门视频都发布在什么时候」，不是「你该什么时候发」；发早了没流量、发晚了错过扶持期，都需要你自己在账号后台验证。`,
      basis: timing.basis,
    });
  }

  out.push({
    text: '以上每一条都能在文末「口径、出处与已知局限」里找到数据来源与样本量。如果一个维度没有样本，本报告不会给出数字——宁可不写，也不编一个看起来很像样的数。',
  });

  return out;
}

// ─── 自检：所有数字是否都带出处 ────────────────────────────

function looksLikeMetric(v: unknown): v is ReportMetric {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.label === 'string' && typeof o.display === 'string' && 'value' in o;
}

/** 递归收集所有 ReportMetric，检查每一个是否都有合法的 basis */
export function validateReport(report: GameIndustryReport): ReportSelfCheck {
  let metricCount = 0;
  let unbacked = 0;

  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (looksLikeMetric(node)) {
      metricCount++;
      const b = (node as ReportMetric).basis;
      if (!b || !b.sourceLabel || !(b.sampleSize > 0)) unbacked++;
      return;
    }
    Object.values(node as Record<string, unknown>).forEach(walk);
  };

  walk(report);
  return { metricCount, unbackedMetricCount: unbacked };
}

// ─── Markdown 导出 ─────────────────────────────────────────

const basisShort = (b: ReportBasis) =>
  `${b.sourceLabel}｜样本量 ${b.sampleSize} 条｜${b.windowDays === null ? '榜单快照口径' : `近 ${b.windowDays} 天`}｜口径：${b.method}`;

/** 表格里统一的「来源与样本量」列，保证不会出现无出处的数字 */
const sourceCell = (m: ReportMetric) => `n=${m.basis.sampleSize}｜${m.basis.windowDays === null ? '榜单快照' : `近 ${m.basis.windowDays} 天`}`;

const fmtGenerated = (ts: number) => new Date(ts).toLocaleString('zh-CN', { hour12: false });

/**
 * 把报告渲染成 Markdown。
 * ★ 只打印 ReportMetric.display + 它自己的 basis：数字和出处是同一个对象的两个字段，
 *   渲染层没有「只打印数字」这条路径。
 */
export function renderReportMarkdown(report: GameIndustryReport): string {
  const L: string[] = [];
  // 机器可读的自检标记：tools\smoke-test.ps1 是纯 ASCII 脚本（PowerShell 5.1
  // 无 BOM 时按 ANSI 读 .ps1，中文字面量会乱码），所以导出件里必须有一个
  // ASCII 标记让冒烟测试断言「所有数字都有出处」。
  L.push(
    `<!-- report-selfcheck ready=${report.ready} metrics=${report.selfCheck.metricCount} unbacked=${report.selfCheck.unbackedMetricCount} -->`,
  );
  L.push('# B站游戏区内容分析报告');
  L.push('');
  L.push(`> 生成时间：${fmtGenerated(report.generatedAt)}`);
  L.push(`> 数据来源：${report.scope.sourceLabel}`);
  L.push(`> 样本量：${report.scope.sampleSize} 条（原始条目池共 ${report.poolSize} 条）`);
  L.push(`> 口径：${report.scope.method}`);
  L.push('> ★ 本报告的每一个数字都标注了来源与样本量；没有样本的维度不会给出数字，而是列在「未能得出的维度」中。');
  L.push('');

  if (!report.ready) {
    L.push(`## 报告暂不可用`);
    L.push('');
    L.push(`原因：${report.error ?? '未知'}`);
    return L.join('\n');
  }

  if (report.selfCheck.unbackedMetricCount > 0) {
    L.push('## ⚠️ 数据自检未通过');
    L.push('');
    L.push(
      `本报告有 ${report.selfCheck.unbackedMetricCount} / ${report.selfCheck.metricCount} 个数字缺少来源声明，请勿引用。这是程序缺陷，不是数据问题。`,
    );
    L.push('');
  }

  // 一、品类分布与竞争强度
  L.push('## 一、品类分布与竞争强度');
  L.push('');
  L.push(`样本口径：${report.categories.length} 个有足够样本的品类，按播放中位降序排列。`);
  L.push('');
  L.push('| 品类 | 样本量 | 时间窗 | 播放中位 | 播放 P90 | 点赞率中位 | 头部集中度 | 竞争强度 | 疑问句标题占比 | 时长中位 | 来源与样本量 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const c of report.categories) {
    L.push(
      `| ${c.label} | ${c.sampleSize} 条 | ${c.windowDays === null ? '榜单快照' : `近 ${c.windowDays} 天`} | ${c.viewMedian.display} | ${c.viewP90.display} | ${
        c.likeRateMedian ? c.likeRateMedian.display : '该来源不提供'
      } | ${c.concentration.display} | ${INTENSITY_LABEL[c.intensity]} | ${c.questionRatio.display} | ${c.durationMedian.display} | ${sourceCell(c.viewMedian)} |`,
    );
  }
  L.push('');
  L.push('**怎么读**：');
  L.push('');
  L.push(
    `- 「播放中位」是同一口径下所有样本的中位数，代表这个品类当前的**水位线**，不是预测值。`,
  );
  L.push(
    `- 「头部集中度」= 播放量前 ${HEAD_SHARE * 100}% 的视频占样本总播放的比例；≥ ${(INTENSITY_HIGH * 100).toFixed(0)}% 记为高、≥ ${(INTENSITY_MEDIUM * 100).toFixed(0)}% 记为中。阈值是本报告自定义的分档，不是平台官方口径。`,
  );
  L.push('- 播放量分位数与集中度来自 M2 基准线快照；疑问句占比与时长中位来自同一次采集的原始条目。');
  L.push('');

  // 二、标题模式
  L.push('## 二、TOP 作品的标题模式');
  L.push('');
  const t = report.titlePattern;
  L.push(`样本口径：${basisShort(t.basis)}`);
  L.push('');
  L.push('| 指标 | 数值 | 来源与样本量 |');
  L.push('|---|---|---|');
  L.push(`| 疑问句标题占比 | ${t.questionRatio.display} | ${sourceCell(t.questionRatio)} |`);
  L.push(`| 标题字数 P25 | ${t.lengthP25.display} | ${sourceCell(t.lengthP25)} |`);
  L.push(`| 标题字数中位 | ${t.lengthMedian.display} | ${sourceCell(t.lengthMedian)} |`);
  L.push(`| 标题字数 P75 | ${t.lengthP75.display} | ${sourceCell(t.lengthP75)} |`);
  L.push('');
  if (t.lengthBuckets.length) {
    L.push('标题字数分布：');
    L.push('');
    L.push('| 字数区间 | 条数 | 占比 | 来源与样本量 |');
    L.push('|---|---|---|---|');
    for (const b2 of t.lengthBuckets) {
      L.push(`| ${b2.label} | ${b2.count} 条 | ${(b2.ratio * 100).toFixed(1)}% | ${sourceCell(t.lengthMedian)} |`);
    }
    L.push('');
  }
  if (t.keywords.length) {
    L.push(`高频内容词（括号内为出现在多少条标题里，共统计 ${t.basis.sampleSize} 条标题）：`);
    L.push('');
    L.push(
      t.keywords.map((k) => `\`${k.word}\`（${k.count} 条，占 ${(k.ratio * 100).toFixed(1)}%）`).join('　'),
    );
    L.push('');
  }
  L.push(`> 局限：${t.caveat}`);
  L.push('');

  // 三、时长–互动率
  L.push('## 三、时长–互动率关系');
  L.push('');
  const c = report.durationCurve;
  L.push(`样本口径：${basisShort(c.basis)}`);
  L.push('');
  if (c.buckets.length) {
    L.push('| 时长区间 | 视频数 | 播放中位 | 点赞率中位 | 来源与样本量 |');
    L.push('|---|---|---|---|---|');
    for (const b2 of c.buckets) {
      L.push(
        `| ${b2.label} | ${b2.videoCount} 条 | ${b2.videoCount ? b2.viewMedian.display : '—'} | ${
          b2.likeRateMedian ? b2.likeRateMedian.display : '—'
        } | ${sourceCell(b2.likeRateMedian ?? b2.viewMedian)} |`,
      );
    }
    L.push('');
    const trendText: Record<ReportDurationCurve['trend'], string> = {
      decreasing: '把达标区间按从短到长排开，点赞率是**下降**的：在这批热门样本里，越短的视频点赞率越高。',
      increasing: '把达标区间按从短到长排开，点赞率是**上升**的：在这批热门样本里，越长的视频点赞率越高。',
      flat: '各时长区间的点赞率**没有明显差别**。',
      unknown: '达标的时长区间不足两个，无法判断点赞率随时长的走势。',
    };
    L.push(
      c.bestBucket
        ? `**结论**：点赞率中位最高的时长区间是「${c.bestBucket}」。`
        : `**结论**：没有任何区间达到 ${MIN_CURVE_BUCKET} 条样本量，本次不给「最优时长」结论。`,
    );
    L.push('');
    L.push(trendText[c.trend]);
    L.push('');
    L.push(
      '计划书把这一维度写成「验证 B站奖励看得久」。这里必须说清楚一件事：上面这张表是**点赞率**，衡量「看完想不想点赞」；而 B站 2023-06 起把前台播放量改成了**播放分钟数**（见文末出处），那才是平台的收益口径。两个指标不是一回事，不能拿点赞率替长视频的收益下结论。',
    );
  } else {
    L.push(`本次无法给出该维度：${c.caveat}`);
  }
  L.push('');
  L.push(`> 局限：${c.caveat}`);
  L.push('');

  // 四、发布时段
  L.push('## 四、发布时段分布');
  L.push('');
  const p = report.publishTiming;
  L.push(`样本口径：${basisShort(p.basis)}｜时区：${p.timezone}`);
  L.push('');
  const nonEmpty = p.buckets.filter((x) => x.videoCount > 0);
  if (nonEmpty.length) {
    L.push('| 发布时段 | 样本条数 | 播放中位 | 来源与样本量 |');
    L.push('|---|---|---|---|');
    for (const b2 of nonEmpty) {
      L.push(
        `| ${String(b2.hour).padStart(2, '0')}:00–${String(b2.hour).padStart(2, '0')}:59 | ${b2.videoCount} 条 | ${wan(
          b2.viewMedian,
        )} | n=${p.basis.sampleSize}｜榜单快照 |`,
      );
    }
    L.push('');
    L.push(
      `**样本最集中的时段**：${p.topHours.map((h) => `${String(h).padStart(2, '0')}:00`).join(' / ')}`,
    );
  } else {
    L.push(`本次无法给出该维度：${p.caveat}`);
  }
  L.push('');
  L.push(`> 局限：${p.caveat}`);
  L.push('');

  // 五、建议
  L.push('## 五、对你自己的选题的建议');
  L.push('');
  report.suggestions.forEach((s, i) => {
    L.push(`${i + 1}. ${s.text}`);
    if (s.basis) L.push(`   - 依据：${basisShort(s.basis)}`);
  });
  L.push('');

  // 六、口径与出处
  L.push('## 六、口径、出处与已知局限');
  L.push('');
  L.push('### 外部证据（含可信度分级）');
  L.push('');
  L.push('| 结论 | 出处 | 等级 | 用在哪 |');
  L.push('|---|---|---|---|');
  for (const e of report.evidence) {
    L.push(`| ${e.claim} | ${e.origin} | ${e.grade} | ${e.usedIn} |`);
  }
  L.push('');
  L.push('> 分级标准：A = 平台官方口径 / 同行评审；B = 第三方大样本；C = 经验帖或无法核实，不用于 KPI。');
  L.push('');
  if (report.unavailable.length) {
    L.push('### 未能得出的维度');
    L.push('');
    for (const u of report.unavailable) L.push(`- ${u}`);
    L.push('');
  }
  L.push('### 已知局限');
  L.push('');
  L.push('- 全部数据来自 B站公开接口的一次快照，不是全量统计；「热门榜」本身只收录已经火了的视频。');
  L.push('- 所有比率（点赞率、收藏率、头部集中度）都是**本报告自采样水位**，业界没有公开可信的游戏区基准，不可当作 KPI 或对外承诺。');
  L.push('- 时长与互动率、发布时段与播放量之间都是横截面相关，没有控制变量，不能读成因果。');
  L.push('');
  L.push('---');
  L.push('');
  L.push('由 Creator Studio 生成（M3 分析报告生成）。报告为机器生成，结论需人工复核后使用。');

  return L.join('\n');
}
