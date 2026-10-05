// ============================================================
//  B站基准线采集器
//
//  用途：为「品类/分区水位线」提供原始样本。两类源：
//
//  ① 热门榜分页  /x/web-interface/popular?ps=50&pn=N
//     - 新鲜（实测样本年龄中位 ~1 天）
//     - 指标完整（view/like/coin/favorite/share/danmaku/reply）
//     - 带 tname 子分区名 → 可按 B站分区聚合
//
//  ② 关键词时间窗  /x/web-interface/wbi/search/type?order=click&pubtime_begin_s=...&pubtime_end_s=...
//     - 实测 pubtime_begin_s/pubtime_end_s 真正生效（days=30 → maxPlay 276万；days=3650 → 3248万）
//     - 得到「近 N 天该关键词最热的视频」，正是品类水位线想要的口径
//     - ★ 该接口不返回 coin / share，字段位为 null —— 上层必须显式声明「该源不提供」，
//       绝不允许用 0 冒充。
//
//  ★ 已废弃的方案（写在这里防止后人回头再踩）：
//    /x/web-interface/ranking/v2?rid=4（游戏区排行榜）实测已冻结 552 天，
//    type=all/origin/rookie 三种都是同一天快照；且 B站没有公开的分区级榜单
//    （17/65/171/172/173 等游戏子分区 rid 全部 code=-400）。
//    所以「品类→rid 映射」这条计划书原路线不成立，改用上面两条源。
// ============================================================

import { BILI_HEADERS, getMixinKey, signWbi } from './bilibiliCollector.js';

/** 归一化后的样本条目。来源不提供的指标一律为 null。 */
export interface RawBenchmarkItem {
  bvid: string;
  title: string;
  /** B站子分区名，如「单机游戏」 */
  tname: string;
  tid: number;
  /** 发布时间（秒，B站原始口径） */
  pubdate: number;
  /** 时长（秒） */
  duration: number;
  views: number;
  likes: number;
  /** 搜索源不提供 → null */
  coins: number | null;
  favorites: number;
  /** 搜索源不提供 → null */
  shares: number | null;
  danmaku: number;
  comments: number;
}

/** 热门榜采集页数：10 页 × 50 = 500 条，实测其中约 130 条属游戏子分区 */
export const POPULAR_PAGES = 10;
/** 搜索时间窗（天） */
export const SEARCH_WINDOW_DAYS = 30;
/** 单个关键词取多少条 */
export const SEARCH_PAGE_SIZE = 30;

const POLITE_DELAY_MS = 900;
const POPULAR_PS = 50;

export const POPULAR_SOURCE_LABEL = 'B站热门榜（全站，按 B站子分区归类）';
export const SEARCH_SOURCE_LABEL = `B站搜索·近${SEARCH_WINDOW_DAYS}天最热`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 把 B站搜索返回的 "5:22" / "1:10:36" 解析成秒；解析不出返回 0 */
export function parseDurationString(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  if (typeof raw !== 'string') return 0;
  const parts = raw.trim().split(':').map((p) => Number(p));
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 归一化热门榜条目（stat 对象，指标齐全） */
function normalizePopular(v: any): RawBenchmarkItem | null {
  const bvid = v?.bvid;
  if (!bvid || !v?.stat) return null;
  return {
    bvid,
    title: String(v.title || ''),
    tname: String(v.tname || ''),
    tid: Number(v.tid) || 0,
    pubdate: Number(v.pubdate) || 0,
    duration: num(v.duration),
    views: num(v.stat.view),
    likes: num(v.stat.like),
    coins: num(v.stat.coin),
    favorites: num(v.stat.favorite),
    shares: num(v.stat.share),
    danmaku: num(v.stat.danmaku),
    comments: num(v.stat.reply),
  };
}

/** 归一化搜索结果（扁平字段，★ 没有 coin/share） */
function normalizeSearch(v: any): RawBenchmarkItem | null {
  const bvid = v?.bvid;
  if (!bvid) return null;
  return {
    bvid,
    title: String(v.title || '').replace(/<[^>]+>/g, ''),
    tname: String(v.typename || ''),
    tid: Number(v.typeid) || 0,
    pubdate: Number(v.pubdate) || 0,
    duration: parseDurationString(v.duration),
    views: num(v.play),
    likes: num(v.like),
    coins: null,
    favorites: num(v.favorites),
    shares: null,
    danmaku: num(v.video_review ?? v.danmaku),
    comments: num(v.review),
  };
}

/** 拉热门榜 N 页。页间 900ms，单页失败跳过不中断整体。 */
export async function fetchPopularPages(pages = POPULAR_PAGES): Promise<RawBenchmarkItem[]> {
  const out: RawBenchmarkItem[] = [];
  const seen = new Set<string>();

  for (let pn = 1; pn <= pages; pn++) {
    try {
      const resp = await fetch(
        `https://api.bilibili.com/x/web-interface/popular?ps=${POPULAR_PS}&pn=${pn}`,
        { headers: BILI_HEADERS },
      );
      const json = (await resp.json()) as any;
      const list: any[] = json?.data?.list || [];
      if (!list.length) break;

      for (const raw of list) {
        const item = normalizePopular(raw);
        if (item && !seen.has(item.bvid)) {
          seen.add(item.bvid);
          out.push(item);
        }
      }
    } catch (err: any) {
      console.warn(`[benchmark] popular pn=${pn} 失败: ${err?.message || err}`);
    }
    if (pn < pages) await sleep(POLITE_DELAY_MS);
  }

  return out;
}

/**
 * 按关键词取「近 windowDays 天最热」视频（order=click + 时间窗）。
 * 需 WBI 签名。返回原始条目（无 coin/share）。
 */
export async function fetchSearchWindow(
  keyword: string,
  windowDays = SEARCH_WINDOW_DAYS,
  pageSize = SEARCH_PAGE_SIZE,
): Promise<RawBenchmarkItem[]> {
  const mixinKey = await getMixinKey();
  const now = Math.floor(Date.now() / 1000);
  const base = {
    search_type: 'video',
    keyword,
    order: 'click',
    page: 1,
    page_size: pageSize,
    pubtime_begin_s: now - windowDays * 86400,
    pubtime_end_s: now,
  };
  // ★ signWbi 只返回 { w_rid, wts }，不含业务参数 —— 必须自己合并回去，
  // 否则请求里只剩签名，接口一律回 code=-400。
  const merged = { ...base, ...signWbi(base, mixinKey) };

  const qs = new URLSearchParams(
    Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, String(v)])),
  ).toString();

  const resp = await fetch(
    `https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`,
    { headers: BILI_HEADERS },
  );
  const json = (await resp.json()) as any;

  if (json?.code !== 0) {
    throw new Error(`搜索接口返回 code=${json?.code} ${json?.message || ''}`.trim());
  }

  const list: any[] = json?.data?.result || [];
  return list.map(normalizeSearch).filter((x): x is RawBenchmarkItem => x !== null);
}

/** 多个关键词合并（按 bvid 去重）。单个关键词失败不影响其它。 */
export async function fetchSearchWindows(
  keywords: string[],
  windowDays = SEARCH_WINDOW_DAYS,
): Promise<RawBenchmarkItem[]> {
  const out: RawBenchmarkItem[] = [];
  const seen = new Set<string>();

  for (const kw of keywords) {
    try {
      const items = await fetchSearchWindow(kw, windowDays);
      for (const item of items) {
        if (!seen.has(item.bvid)) {
          seen.add(item.bvid);
          out.push(item);
        }
      }
    } catch (err: any) {
      console.warn(`[benchmark] 搜索「${kw}」失败: ${err?.message || err}`);
    }
    await sleep(POLITE_DELAY_MS);
  }

  return out;
}
