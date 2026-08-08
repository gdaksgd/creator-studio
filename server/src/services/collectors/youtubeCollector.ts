import { ProxyAgent } from 'undici';
import { config, isYouTubeConfigured } from '../../config.js';
import type { NewsItem } from '../../types.js';

// ─── Search queries ────────────────────────────────────────

const SEARCH_QUERIES = [
  // Horror game
  { q: 'horror game gameplay 2026', category: 'horror' as const },
  { q: '恐怖游戏 实况', category: 'horror' as const },
  { q: 'scariest horror game moments', category: 'horror' as const },
  { q: 'new indie horror game', category: 'horror' as const },
  { q: 'survival horror game', category: 'horror' as const },
  // Card game
  { q: 'hearthstone new deck 2026', category: 'card' as const },
  { q: 'yugioh master duel', category: 'card' as const },
  { q: '卡牌游戏 新卡组', category: 'card' as const },
  { q: 'slay the spire gameplay', category: 'card' as const },
  { q: 'mtg arena best deck', category: 'card' as const },
  { q: 'marvel snap new season', category: 'card' as const },
  { q: 'pokemon tcg pocket', category: 'card' as const },
];

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

  for (const { q, category } of SEARCH_QUERIES) {
    try {
      // Step 1: Search
      const searchUrl = new URL('https://www.googleapis.com/youtube/v3/search');
      searchUrl.searchParams.set('part', 'snippet');
      searchUrl.searchParams.set('q', q);
      searchUrl.searchParams.set('type', 'video');
      searchUrl.searchParams.set('order', 'viewCount');
      searchUrl.searchParams.set('maxResults', '10');
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

        if (views < 5000) continue;

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
