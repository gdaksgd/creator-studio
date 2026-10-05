import crypto from 'crypto';
import { CATEGORIES, GENERAL_CATEGORY } from '../../config/categories.js';
import type { NewsItem, NewsCategory } from '../../types.js';

// ─── WBI Signing ───────────────────────────────────────────

const MIXIN_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 52, 44, 34,
];

interface WbiCache {
  imgKey: string;
  subKey: string;
  mixinKey: string;
  expires: number;
}

let wbiCache: WbiCache | null = null;

export const BILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

/** 供基准线采集器复用；带 1 小时缓存 */
export async function getMixinKey(): Promise<string> {
  if (wbiCache && wbiCache.expires > Date.now()) {
    return wbiCache.mixinKey;
  }

  const resp = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: BILI_HEADERS,
  });
  const data = (await resp.json()) as any;
  const wbiImg = data?.data?.wbi_img;
  if (!wbiImg?.img_url || !wbiImg?.sub_url) {
    throw new Error('Failed to get wbi keys from nav API');
  }

  const imgKey = (wbiImg.img_url as string).split('/').pop()?.split('.')[0] || '';
  const subKey = (wbiImg.sub_url as string).split('/').pop()?.split('.')[0] || '';
  const raw = imgKey + subKey;
  const mixinKey = MIXIN_ENC_TAB.map((n) => raw[n]).join('').slice(0, 32);

  wbiCache = { imgKey, subKey, mixinKey, expires: Date.now() + 3600000 };
  return mixinKey;
}

export function signWbi(params: Record<string, string | number>, mixinKey: string) {
  const wts = Math.floor(Date.now() / 1000);
  const allParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    allParams[k] = String(v);
  }
  allParams.wts = String(wts);

  const sorted = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const wRid = crypto.createHash('md5').update(sorted + mixinKey).digest('hex');
  return { w_rid: wRid, wts };
}

// ─── Keywords & Filters ────────────────────────────────────

// 追热点：最少播放量阈值，低于此值的资讯没有追的价值
const MIN_VIEWS = 5000;

// 品类分类关键词全部来自 config/categories.ts 的 rssKeywords（单一事实来源），
// 按 CATEGORIES 声明顺序依次匹配，命中即归入该品类；全部未命中则落桶到 general。
const CATEGORY_MATCHERS: { id: string; keywords: string[] }[] = CATEGORIES
  .filter((c) => c.rssKeywords.length > 0)
  .map((c) => ({ id: c.id, keywords: c.rssKeywords.map((k) => k.toLowerCase()) }));

function categorize(title: string, desc: string): NewsCategory {
  const text = (title + ' ' + desc).toLowerCase();
  for (const { id, keywords } of CATEGORY_MATCHERS) {
    if (keywords.some((k) => text.includes(k))) return id;
  }
  return GENERAL_CATEGORY.id;
}

// 搜索关键词同样从 config/categories.ts 汇总：优先取该品类 newsQueries 里的中文词
//（更适合 B 站搜索），没有中文词就退化为品类 label。
// ★ 总量上限：search API 每个关键词一次请求，品类扩到 8 个后需限制请求数，
//   这里最多 MAX_SEARCH_QUERIES 个关键词，避免采集时间与失败率暴涨。
const MAX_SEARCH_QUERIES = 16;

function buildSearchQueries(): string[] {
  const hasCjk = /[\u4e00-\u9fff]/;
  const queries = CATEGORIES.map((c) => c.newsQueries.find((q) => hasCjk.test(q)) || c.label);
  return Array.from(new Set(queries)).slice(0, MAX_SEARCH_QUERIES);
}

const SEARCH_QUERIES = buildSearchQueries();

// ─── Helpers ───────────────────────────────────────────────

function parseVideo(video: any, sourceLabel: string): NewsItem {
  const title = (video.title || '').replace(/<[^>]+>/g, '');
  const desc = (video.description || video.desc || '').slice(0, 300);
  const category = categorize(title, desc);
  const pubdate = video.pubdate ? video.pubdate * 1000 : Date.now();

  // B站不同 API 返回的播放量字段不同:
  // - popular API: video.stat.view
  // - search API:  video.play
  const views = video.stat?.view || video.play || 0;
  const likes = video.stat?.like || 0;
  const comments = video.stat?.reply || video.video_review || 0;

  return {
    id: `bili_${video.bvid || Math.random().toString(36).slice(2)}`,
    title,
    summary: desc || title,
    url: `https://www.bilibili.com/video/${video.bvid}`,
    source: video.owner?.name || video.author || sourceLabel,
    sourceType: 'bilibili',
    category,
    thumbnail: (video.pic || '').replace('http://', 'https://'),
    publishedAt: pubdate,
    collectedAt: Date.now(),
    metrics: { views, likes, comments },
  };
}

/** 播放量格式化，用于日志 */
function formatViews(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}千`;
  return String(n);
}

// ─── API fetchers ──────────────────────────────────────────

/** Popular API — 热门视频，天然高播放量 + 新 */
async function fetchPopular(): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  try {
    const resp = await fetch(
      'https://api.bilibili.com/x/web-interface/popular?ps=50&pn=1',
      { headers: BILI_HEADERS },
    );
    if (!resp.ok) return items;

    const data = (await resp.json()) as any;
    const videos = data?.data?.list || [];

    for (const video of videos) {
      const views = video.stat?.view || 0;
      // 热门榜本身就有高播放，但保险起见再过滤一次
      if (views < MIN_VIEWS) continue;

      const title = (video.title || '').replace(/<[^>]+>/g, '');
      const desc = (video.desc || '').slice(0, 300);
      const category = categorize(title, desc);

      if (category === GENERAL_CATEGORY.id) continue;

      const item = parseVideo(video, 'B站热门');
      items.push(item);
    }

    console.log(`[Bilibili] 热门: ${items.length} 条 (≥${formatViews(MIN_VIEWS)}播放)`);
  } catch (err) {
    console.error('[Bilibili] 热门API失败:', err);
  }

  return items;
}

/**
 * Search API — 综合排序 (totalrank)
 * totalrank = 时效 + 播放量 + 互动量的综合排名，最适合"追热点"
 */
async function fetchSearch(keyword: string, order: string = 'totalrank'): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  try {
    const mixinKey = await getMixinKey();

    const params: Record<string, string | number> = {
      search_type: 'video',
      keyword,
      order,
      page: 1,
      page_size: 30,
    };

    const { w_rid, wts } = signWbi(params, mixinKey);

    const url = new URL('https://api.bilibili.com/x/web-interface/wbi/search/type');
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    url.searchParams.set('w_rid', w_rid);
    url.searchParams.set('wts', String(wts));

    const resp = await fetch(url.toString(), { headers: BILI_HEADERS });
    if (!resp.ok) return items;

    const data = (await resp.json()) as any;
    const results = data?.data?.result || [];

    let skipped = 0;
    for (const r of results) {
      const views = r.stat?.view || r.play || 0;
      if (views < MIN_VIEWS) {
        skipped++;
        continue;
      }
      items.push(parseVideo(r, `B站搜索-${keyword}`));
    }

    if (items.length > 0 || skipped > 0) {
      const top = items.slice(0, 3).map((i) => `  ${i.title.slice(0, 30)}... [${formatViews(i.metrics?.views || 0)}播放]`).join('\n');
      console.log(`[Bilibili] 搜索"${keyword}"(${order}): ${items.length} 条, 跳过 ${skipped} 条低播放\n${top || '  (无)'}`);
    }
  } catch (err) {
    console.error(`[Bilibili] 搜索"${keyword}"失败:`, (err as Error).message);
  }

  return items;
}

// ─── Main collector ────────────────────────────────────────

export async function collectBilibili(): Promise<NewsItem[]> {
  const seen = new Set<string>();
  const allItems: NewsItem[] = [];

  // 1. Popular API — 天然热点
  try {
    const popularItems = await fetchPopular();
    for (const item of popularItems) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        allItems.push(item);
      }
    }
  } catch (err) {
    console.error('[Bilibili] 热门API错误:', err);
  }

  // 2. Search API — totalrank 综合排序 (热度+时效)
  const searchResults = await Promise.allSettled(
    SEARCH_QUERIES.map((kw) => fetchSearch(kw, 'totalrank')),
  );

  for (const result of searchResults) {
    if (result.status !== 'fulfilled') continue;
    for (const item of result.value) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        allItems.push(item);
      }
    }
  }

  // 3. 按播放量排序，热点优先
  allItems.sort((a, b) => (b.metrics?.views || 0) - (a.metrics?.views || 0));

  console.log(`[Bilibili] 总共收集: ${allItems.length} 条热点资讯`);
  if (allItems.length > 0) {
    console.log(`[Bilibili] TOP5:`);
    allItems.slice(0, 5).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.title.slice(0, 50)} [${formatViews(item.metrics?.views || 0)}播放]`);
    });
  }

  return allItems;
}
