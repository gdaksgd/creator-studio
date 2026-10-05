// ============================================================
//  基准线服务（M2）
//
//  解决的问题：AI 评估选题时给出的「预估播放量」「热度」原本是纯模型判断，
//  没有任何数据支撑。这里为每个品类算出一条真实水位线，注入提示词，
//  并在响应里带上 basis 字段，让用户一眼看出这个数字有没有依据。
//
//  ★ 数据诚实原则（计划书第 3 节第 4 条）在代码里的落点：
//    1. 每个 BenchmarkSample 必带 sampleSize / sourceLabel / windowDays / collectedAt；
//    2. 样本量低于 MIN_*_SAMPLE 时**不生成样本**，前端显示「暂无基准数据」+ 实际采到的条数，
//       而不是造一个 0 或一个看起来很像样的假数字；
//    3. 来源不提供的指标（搜索接口没有投币/分享）直接不写入 rates，并登记进 unavailable，
//       界面上原样显示「该来源不提供」，绝不用 0 顶替。
// ============================================================

import fs from 'fs';
import path from 'path';
import { config } from '../config.js';
import { CATEGORIES } from '../config/categories.js';
import { atomicWriteFile } from '../db.js';
import type {
  BenchmarkBasis,
  BenchmarkGap,
  BenchmarkSample,
  BenchmarkSnapshot,
  MetricBand,
  RateBand,
} from '../types.js';
import {
  POPULAR_PAGES,
  POPULAR_SOURCE_LABEL,
  SEARCH_SOURCE_LABEL,
  SEARCH_WINDOW_DAYS,
  fetchPopularPages,
  fetchSearchWindows,
  type RawBenchmarkItem,
} from './collectors/bilibiliBenchmarkCollector.js';

const CACHE_PATH = path.join(config.dataDir, 'benchmark.json');
/** 计划书要求缓存 TTL ≥ 6 小时，避免频繁打到 B站触发风控 */
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** 样本量门槛：低于此值视为「样本不足」，不发布基准线 */
const MIN_CATEGORY_SAMPLE = 15;
const MIN_PARTITION_SAMPLE = 10;

/** B站游戏相关子分区名（来自热门榜 tname 实测） */
export const GAME_PARTITIONS = [
  '单机游戏',
  '手机游戏',
  '网络游戏',
  '电子竞技',
  '音游',
  '桌游棋牌',
  'GMV',
];

interface CacheFile {
  collectedAt: number;
  samples: BenchmarkSample[];
  gaps: BenchmarkGap[];
  /**
   * M3 原始样本池。M2 只落盘聚合带（分位数），但「标题模式 / 时长–互动率 / 发布时段」
   * 这三个维度必须在原始条目上算，所以这里把归一化后的条目也一并存下来。
   * ★ 只新增字段、不改已有字段：旧缓存读出来 pool 为 undefined，
   *   上层据此触发一次重采（见 needsPool），而不是拿空数组算出「0 条」的假结论。
   */
  popular: PopularPoolItem[];
  search: SearchPoolItem[];
}

/** 热门榜池：指标完整（含投币/分享），带 B站子分区名 */
export type PopularPoolItem = RawBenchmarkItem;

/** 搜索池：该来源不提供投币/分享；group = 采到它的品类 id */
export interface SearchPoolItem extends RawBenchmarkItem {
  group: string;
}

// ─── 统计工具 ──────────────────────────────────────────────

/** 线性插值分位。传入的数组必须已升序。 */
export function quantile(sortedAsc: number[], p: number): number {
  if (!sortedAsc.length) return 0;
  if (sortedAsc.length === 1) return sortedAsc[0];
  const pos = p * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

function bandFrom(values: number[]): MetricBand {
  const s = [...values].sort((a, b) => a - b);
  return {
    min: s[0] ?? 0,
    p25: quantile(s, 0.25),
    median: quantile(s, 0.5),
    p75: quantile(s, 0.75),
    p90: quantile(s, 0.9),
    max: s[s.length - 1] ?? 0,
  };
}

function rateBandFrom(rates: number[]): RateBand {
  const s = [...rates].sort((a, b) => a - b);
  return { p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75) };
}

/** value 在升序数组中的分位（0-100），表示「高于样本中百分之几的视频」 */
export function percentileOf(sortedAsc: number[], value: number): number {
  if (!sortedAsc.length) return 0;
  let below = 0;
  for (const v of sortedAsc) {
    if (v <= value) below++;
    else break;
  }
  return Math.round((below / sortedAsc.length) * 100);
}

/**
 * AI 明说「估不出来」的措辞。
 * ★ 不先拦掉这类文本，就会把解释里的「粉丝 10 人」「30 条样本」当成播放量预测，
 *   进而算出一个「你的预测低于样本最低值（P0）」这种完全错误的结论。
 */
const NO_ESTIMATE =
  /无法(预估|估计|预测|判断|给出)|难以(预估|估计|预测|判断)|不好(预估|估计)|没有?(足够)?(的)?(数据|依据)|缺少?(数据|依据)|暂无数据|不确定|无法确定/;

/**
 * 把 AI 返回的「预估播放量区间」文本解析成单个代表值。
 * 支持「5-10万」「5万到10万」「10万」「3000」。
 * ★ 解析不出返回 null —— 绝不返回 0，因为 0 会伪装成「有个很小的数」。
 */
export function parseEstimatedViews(text: string | undefined | null): number | null {
  if (!text) return null;
  const raw = String(text);
  if (NO_ESTIMATE.test(raw)) return null;
  const cleaned = raw.replace(/[,，\s]/g, '');
  const unit = (u: string | undefined) =>
    !u ? 1 : /[万千wkWK]/.test(u) ? (/[万wkWK]/.test(u) ? 10000 : 1000) : 1;

  // 区间：5-10万 / 5万~10万 / 5万到10万
  const range = cleaned.match(
    /(\d+(?:\.\d+)?)([万千wkWK])?\s*[-~—–至到]\s*(\d+(?:\.\d+)?)([万千wkWK])?/,
  );
  if (range) {
    // 只有一端带单位时，另一端沿用同一个单位：「5-10万」= 5万~10万。
    // 若不这么做，缺失的一端会退化成「个」，把区间读成 5~100000 这种荒唐值。
    const u1 = range[2];
    const u2 = range[4];
    const a = Number(range[1]) * unit(u1 || u2);
    const b = Number(range[3]) * unit(u2 || u1);
    if (a > 0 && b > 0) {
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      // 同一单位解释后两端仍相差 50 倍以上（如「3000-5万」→ 3000万~5万）说明是文本噪声，不硬算
      if (hi / lo <= 50) return Math.round((a + b) / 2);
    }
    return null;
  }

  const single = cleaned.match(/(\d+(?:\.\d+)?)([万千wkWK])?/);
  if (single) {
    const v = Number(single[1]) * unit(single[2]);
    return v > 0 ? Math.round(v) : null;
  }
  return null;
}

// ─── 样本构建 ──────────────────────────────────────────────

interface SampleMeta {
  scope: BenchmarkSample['scope'];
  key: string;
  label: string;
  source: BenchmarkSample['source'];
  sourceLabel: string;
  windowDays: number | null;
  minSample: number;
}

function buildSample(items: RawBenchmarkItem[], meta: SampleMeta): BenchmarkSample | null {
  if (items.length < meta.minSample) return null;

  const views = items.map((i) => i.views).sort((a, b) => a - b);
  const durations = items.map((i) => i.duration).filter((d) => d > 0).sort((a, b) => a - b);

  // 来源是否真的提供了投币/分享：只要有一条是 null，就认为该来源不提供
  const hasCoins = items.every((i) => i.coins !== null);
  const hasShares = items.every((i) => i.shares !== null);
  const rate = (pick: (i: RawBenchmarkItem) => number | null) =>
    rateBandFrom(items.map((i) => (i.views > 0 ? (pick(i) ?? 0) / i.views : 0)));

  const unavailable: string[] = [];
  if (!hasCoins) unavailable.push('投币率（该数据源不返回投币数）');
  if (!hasShares) unavailable.push('分享率（该数据源不返回分享数）');

  return {
    scope: meta.scope,
    key: meta.key,
    label: meta.label,
    sampleSize: items.length,
    source: meta.source,
    sourceLabel: meta.sourceLabel,
    windowDays: meta.windowDays,
    collectedAt: Date.now(),
    views: bandFrom(views),
    durations: durations.length ? bandFrom(durations) : bandFrom([0]),
    rates: {
      like: rate((i) => i.likes),
      favorite: rate((i) => i.favorites),
      danmaku: rate((i) => i.danmaku),
      comment: rate((i) => i.comments),
      ...(hasCoins ? { coin: rate((i) => i.coins) } : {}),
      ...(hasShares ? { share: rate((i) => i.shares) } : {}),
    },
    unavailable,
    viewDistribution: views,
  };
}

// ─── 缓存 ─────────────────────────────────────────────────

let cache: CacheFile | null = null;
let cacheLoaded = false;
let collectingPromise: Promise<BenchmarkSnapshot> | null = null;
let lastError: string | undefined;

function readCache(): CacheFile | null {
  if (cacheLoaded) return cache;
  cacheLoaded = true;
  try {
    if (fs.existsSync(CACHE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')) as CacheFile;
      if (parsed && Array.isArray(parsed.samples) && parsed.samples.length) {
        cache = parsed;
      }
    }
  } catch (err: any) {
    console.warn(`[benchmark] 缓存读取失败，将重新采集: ${err?.message || err}`);
  }
  return cache;
}

function writeCache(next: CacheFile): void {
  cache = next;
  cacheLoaded = true;
  try {
    atomicWriteFile(CACHE_PATH, JSON.stringify(next, null, 1));
  } catch (err: any) {
    // 写盘失败不影响本次结果，只是重启后要重新采集
    console.warn(`[benchmark] 缓存写盘失败: ${err?.message || err}`);
  }
}

function snapshotFromCache(): BenchmarkSnapshot {
  const c = readCache();
  return {
    ready: !!c && c.samples.length > 0,
    collecting: collectingPromise !== null,
    collectedAt: c?.collectedAt ?? null,
    error: lastError,
    samples: c?.samples ?? [],
    gaps: c?.gaps ?? [],
  };
}

/**
 * M3 的报告要算「标题模式 / 时长–互动率 / 发布时段」，需要原始条目池。
 * M2 版本写出的缓存没有这两个字段 —— 把它并入「过期」判定，
 * 这样升级后会自动补采一次，而不是让报告页面永远显示「暂无数据」。
 */
function needsPool(c: CacheFile | null): boolean {
  return !c || !Array.isArray(c.popular) || !Array.isArray(c.search);
}

// ─── 采集 ─────────────────────────────────────────────────

async function collectAll(): Promise<CacheFile> {
  const samples: BenchmarkSample[] = [];
  const gaps: BenchmarkGap[] = [];
  const searchPool: SearchPoolItem[] = [];

  const popular = await fetchPopularPages(POPULAR_PAGES);
  console.log(`[benchmark] 热门榜采集 ${popular.length} 条`);

  const gamePool = popular.filter((i) => GAME_PARTITIONS.includes(i.tname));

  const gameSample = buildSample(gamePool, {
    scope: 'game',
    key: 'game',
    label: 'B站游戏区整体',
    source: 'bilibili-popular',
    sourceLabel: POPULAR_SOURCE_LABEL,
    windowDays: null,
    minSample: MIN_PARTITION_SAMPLE,
  });
  if (gameSample) samples.push(gameSample);
  else gaps.push({ key: 'game', label: 'B站游戏区整体', sampleSize: gamePool.length, needed: MIN_PARTITION_SAMPLE });

  for (const part of GAME_PARTITIONS) {
    const sub = popular.filter((i) => i.tname === part);
    const s = buildSample(sub, {
      scope: 'partition',
      key: part,
      label: `B站·${part}分区`,
      source: 'bilibili-popular',
      sourceLabel: POPULAR_SOURCE_LABEL,
      windowDays: null,
      minSample: MIN_PARTITION_SAMPLE,
    });
    if (s) samples.push(s);
    else if (sub.length) gaps.push({ key: part, label: `B站·${part}分区`, sampleSize: sub.length, needed: MIN_PARTITION_SAMPLE });
  }

  // 品类级：逐个品类搜索（关键词间自带节流）
  for (const cat of CATEGORIES) {
    if (!cat.biliKeywords.length) continue;
    const items = await fetchSearchWindows(cat.biliKeywords, SEARCH_WINDOW_DAYS);
    for (const it of items) searchPool.push({ ...it, group: cat.id });
    const s = buildSample(items, {
      scope: 'category',
      key: cat.id,
      label: cat.label,
      source: 'bilibili-search',
      sourceLabel: SEARCH_SOURCE_LABEL,
      windowDays: SEARCH_WINDOW_DAYS,
      minSample: MIN_CATEGORY_SAMPLE,
    });
    if (s) samples.push(s);
    else gaps.push({ key: cat.id, label: cat.label, sampleSize: items.length, needed: MIN_CATEGORY_SAMPLE });
    console.log(`[benchmark] 品类 ${cat.id}: ${items.length} 条${s ? ' ✓' : ' （样本不足）'}`);
  }

  if (!samples.length) {
    throw new Error('两类数据源都没有采到足够样本');
  }

  return { collectedAt: Date.now(), samples, gaps, popular, search: searchPool };
}

/** 强制全量重采（并发调用会复用同一个进行中的任务） */
export function refreshAll(): Promise<BenchmarkSnapshot> {
  if (collectingPromise) return collectingPromise;

  const p = (async () => {
    try {
      const next = await collectAll();
      lastError = undefined;
      writeCache(next);
      console.log(`[benchmark] 采集完成：${next.samples.length} 条基准线，${next.gaps.length} 项样本不足`);
    } catch (err: any) {
      // 失败时保留上次缓存（计划书风险 R：-352 风控时走旧数据）
      lastError = err?.message || String(err);
      console.error(`[benchmark] 采集失败，沿用旧缓存: ${lastError}`);
    }
    return snapshotFromCache();
  })();

  collectingPromise = p;
  void p.finally(() => {
    collectingPromise = null;
  });
  return p;
}

/** 确保有可用缓存；过期则重采。已有旧缓存时即使重采失败也不抛错。 */
export async function ensureReady(): Promise<void> {
  const c = readCache();
  if (c && c.samples.length && !needsPool(c) && Date.now() - c.collectedAt <= CACHE_TTL_MS) return;
  await refreshAll();
}

/** 只读快照。缓存过期时在后台触发重采，不阻塞调用方。 */
export function getSnapshot(): BenchmarkSnapshot {
  const c = readCache();
  const stale = !c || Date.now() - c.collectedAt > CACHE_TTL_MS || needsPool(c);
  if (stale && !collectingPromise) void refreshAll();
  return snapshotFromCache();
}

/** 取某品类的基准线；没有就是没有，返回 null。 */
export function getCategorySample(categoryId: string): BenchmarkSample | null {
  const c = readCache();
  if (!c) return null;
  return c.samples.find((s) => s.scope === 'category' && s.key === categoryId) ?? null;
}

// ─── 给 AI 用 ──────────────────────────────────────────────

const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const wan = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(Math.round(n)));

/**
 * 把品类的基准线渲染成提示词段落。
 * 返回 null 表示没有该品类的可信样本 —— 调用方必须据此声明「无数据支撑」。
 */
export function formatBenchmarkForPrompt(categoryId: string): string | null {
  const s = getCategorySample(categoryId);
  if (!s) return null;

  const window = s.windowDays === null ? '榜单当前快照（非固定时间窗）' : `近 ${s.windowDays} 天`;
  const lines = [
    `## 真实基准数据（可直接引用，但必须标注来源）`,
    `来源：${s.sourceLabel}｜时间窗：${window}｜样本量：${s.sampleSize} 条`,
    `播放量分布：中位 ${wan(s.views.median)}｜P25 ${wan(s.views.p25)}｜P75 ${wan(s.views.p75)}｜P90 ${wan(s.views.p90)}`,
  ];

  if (s.rates.like) lines.push(`点赞率：中位 ${pct(s.rates.like.median)}（P25 ${pct(s.rates.like.p25)} / P75 ${pct(s.rates.like.p75)}）`);
  if (s.rates.coin) lines.push(`投币率：中位 ${pct(s.rates.coin.median)}`);
  if (s.rates.favorite) lines.push(`收藏率：中位 ${pct(s.rates.favorite.median)}`);
  if (s.rates.share) lines.push(`分享率：中位 ${pct(s.rates.share.median)}`);
  if (s.unavailable.length) lines.push(`本数据源明确不提供：${s.unavailable.join('、')}`);

  lines.push(
    '',
    '使用要求：',
    `1. 引用上述数字时必须写明「来源 + 样本量」，例如「据${s.sourceLabel}${s.sampleSize}条样本，该品类播放中位约${wan(s.views.median)}」。`,
    '2. 不要把这些数字当成精确预测，它们只代表这个品类的当前水位。',
    '3. 本数据源不提供的指标，直接说「该数据源不提供」，不要用估计值或 0 代替。',
    '4. 如果上面的基准数据不足以支撑你的结论，就明确说依据不足，不要编造数据。',
  );

  return lines.join('\n');
}

/**
 * 根据 AI 给出的预估播放量区间，算出它在样本中的分位，组装成依据声明。
 * 拿不到样本或解析不出数字时，返回 { source: 'ai' }，明确表示这次没有数据支撑。
 */
export function buildBasis(categoryId: string, estimatedViewsText: string | undefined): BenchmarkBasis {
  const s = getCategorySample(categoryId);
  if (!s) return { source: 'ai' };

  const basis: BenchmarkBasis = {
    source: 'benchmark',
    scope: s.scope,
    key: s.key,
    label: s.label,
    sampleSize: s.sampleSize,
    windowDays: s.windowDays,
  };

  const value = parseEstimatedViews(estimatedViewsText);
  if (value !== null) {
    basis.percentile = percentileOf(s.viewDistribution, value);
  }
  return basis;
}

/** 供路由展示的完整样本（去掉给 AI 用的内部字段） */
export function listSamples(): BenchmarkSample[] {
  return readCache()?.samples ?? [];
}

// ─── 给 M3 报告用 ──────────────────────────────────────────

/**
 * 原始样本池。缺池（旧版缓存）时返回 null —— 调用方必须如实说明「需要重新采集」，
 * 绝不能把空池当成「样本里一条视频都没有」。
 */
export function getReportPool(): {
  popular: PopularPoolItem[];
  search: SearchPoolItem[];
  collectedAt: number;
} | null {
  const c = readCache();
  if (!c || !Array.isArray(c.popular) || !Array.isArray(c.search)) return null;
  return { popular: c.popular, search: c.search, collectedAt: c.collectedAt };
}

/** 采集中的进度（报告路由用来告诉前端「正在补采」） */
export function isCollecting(): boolean {
  return collectingPromise !== null;
}

/** 上一次采集失败原因（有旧缓存时会带在快照里） */
export function lastCollectError(): string | undefined {
  return lastError;
}

/** 每个品类在搜索池里的样本量，供报告解释「为什么这个品类没有基准线」 */
export function searchPoolSizeByGroup(): Record<string, number> {
  const c = readCache();
  const out: Record<string, number> = {};
  for (const item of c?.search ?? []) {
    out[item.group] = (out[item.group] ?? 0) + 1;
  }
  return out;
}
