import { ProxyAgent } from 'undici';
import { config, isYouTubeConfigured } from '../../config.js';
import { CATEGORIES } from '../../config/categories.js';
import type { NewsItem } from '../../types.js';

// ─── Search queries ────────────────────────────────────────
//
// 关键词全部来自 config/categories.ts 的 newsQueries（品类单一事实来源），
// 新增品类会自动带上它的关键词，这里不再维护硬编码清单。
//
// ★ 配额控制：YouTube Data API 的一次 search.list 就要 100 单位配额，
//   而每日默认配额只有 10,000 单位（≈100 次 search）。品类从 2 个扩到 8 个后，
//   若把所有 newsQueries 全展开约 40 条，会直接吃掉近一半配额并拖长采集时间。
//   因此这里用 MAX_QUERIES 做总量硬上限，并按「轮次」取词：每个品类先各取第 1 个关键词，
//   再各取第 2 个……从而保证每个品类都有覆盖机会，而不是被前两个品类的词占满。
const MAX_QUERIES = 20;

function buildSearchQueries(): { q: string; category: string }[] {
  const queries: { q: string; category: string }[] = [];
  const maxLen = CATEGORIES.reduce((m, c) => Math.max(m, c.newsQueries.length), 0);

  for (let i = 0; i < maxLen; i++) {
    for (const c of CATEGORIES) {
      const q = c.newsQueries[i];
      if (!q) continue;
      queries.push({ q, category: c.id });
      if (queries.length >= MAX_QUERIES) return queries;
    }
  }
  return queries;
}

const SEARCH_QUERIES = buildSearchQueries();

// ─── Proxy setup ───────────────────────────────────────────

function getProxyDispatcher(): any {
  const proxyUrl = process.env.HTTP_PROXY || process.env.http_proxy || '';
  if (!proxyUrl) return undefined;

  try {
    return new ProxyAgent({ uri: proxyUrl });
  } catch (err) {
    console.log(`[YouTube] ProxyAgent failed: ${err}`);
    return undefined;
  }
}

// ─── Collector ─────────────────────────────────────────────

export async function collectYouTube(): Promise<NewsItem[]> {
  if (!isYouTubeConfigured()) {
    console.log('[YouTube] API key not configured, skipping');
    return [];
  }

  const items: NewsItem[] = [];
  const seenIds = new Set<string>();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const dispatcher = getProxyDispatcher();
  const fetchInit: any = {};
  if (dispatcher) {
    fetchInit.dispatcher = dispatcher;
    console.log(`[YouTube] Using proxy: ${process.env.HTTP_PROXY}`);
  } else {
    console.log('[YouTube] No proxy — Google may be blocked in China');
  }

  console.log(`[YouTube] 使用 ${SEARCH_QUERIES.length} 个搜索关键词（配额上限 ${MAX_QUERIES}）`);

  for (const { q, category } of SEARCH_QUERIES) {
    try {
      // Step 1: Search
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      searchUrl.searchParams.set('part', 'snippet');
      searchUrl.searchParams.set('q', q);
      searchUrl.searchParams.set('type', 'video');
      // 按发布时间排序，才能抓到真正最新的视频（viewCount 会漏掉刚发布、观看量还低的视频）
      searchUrl.searchParams.set('order', 'date');
      searchUrl.searchParams.set('maxResults', '15');
      searchUrl.searchParams.set('publishedAfter', oneWeekAgo);
      searchUrl.searchParams.set('key', config.youtubeApiKey);

      const searchResp = await fetch(searchUrl.toString(), fetchInit);

      if (!searchResp.ok) {
        const errText = await searchResp.text().catch(() => '');
        console.error(`[YouTube] Search ${searchResp.status} for "${q}": ${errText.slice(0, 150)}`);
        continue;
      }

      const searchData = (await searchResp.json()) as any;
      const videoIds: string[] = (searchData.items || [])
        .map((v: any) => v.id?.videoId)
        .filter(Boolean);

      if (videoIds.length === 0) continue;

      const newIds = videoIds.filter((id: string) => !seenIds.has(id));
      if (newIds.length === 0) continue;
      newIds.forEach((id: string) => seenIds.add(id));

      // Step 2: Get video statistics
      const statsUrl = new URL('https://www.googleapis.com/youtube/v3/videos');
      statsUrl.searchParams.set('part', 'snippet,statistics');
      statsUrl.searchParams.set('id', newIds.join(','));
      statsUrl.searchParams.set('key', config.youtubeApiKey);

      const statsResp = await fetch(statsUrl.toString(), fetchInit);

      if (!statsResp.ok) continue;

      const statsData = (await statsResp.json()) as any;

      for (const video of statsData.items || []) {
        const views = parseInt(video.statistics?.viewCount || '0');
        const likes = parseInt(video.statistics?.likeCount || '0');
        const comments = parseInt(video.statistics?.commentCount || '0');

        // 新发布的视频观看量天然偏低，门槛降到 1000，避免把刚发布的好内容滤掉
        if (views < 1000) continue;

        items.push({
          id: `yt_${video.id}`,
          title: video.snippet.title,
          summary: video.snippet.description?.slice(0, 300) || '',
          url: `https://www.youtube.com/watch?v=${video.id}`,
          source: video.snippet.channelTitle || 'YouTube',
          sourceType: 'youtube',
          category,
          thumbnail: video.snippet.thumbnails?.medium?.url,
          publishedAt: new Date(video.snippet.publishedAt).getTime(),
          collectedAt: Date.now(),
          metrics: { views, likes, comments },
        });
      }
    } catch (err: any) {
      const msg = err?.cause?.code || err?.code || err.message || String(err);
      console.error(`[YouTube] Error for "${q}": ${msg}`);
    }
  }

  if (items.length > 0) {
    console.log(`[YouTube] Collected ${items.length} items`);
  } else {
    console.log('[YouTube] No results — check API quota or proxy');
  }

  return items;
}
