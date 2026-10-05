import RSSParser from 'rss-parser';
import crypto from 'crypto';
import { CATEGORIES, GENERAL_CATEGORY } from '../../config/categories.js';
import type { NewsItem, NewsCategory } from '../../types.js';

const rssParser = new RSSParser({ timeout: 15000 });

interface FeedConfig {
  url: string;
  source: string;
  category: NewsCategory;
}

const FEEDS: FeedConfig[] = [
  { url: 'https://www.pcgamer.com/rss/', source: 'PC Gamer', category: 'general' },
  { url: 'https://www.eurogamer.net/feed', source: 'Eurogamer', category: 'general' },
  { url: 'https://www.rockpapershotgun.com/feed', source: 'Rock Paper Shotgun', category: 'general' },
  { url: 'https://www.gamespot.com/feeds/mashup/', source: 'GameSpot', category: 'general' },
  { url: 'https://feeds.feedburner.com/ign/all', source: 'IGN', category: 'general' },
  { url: 'https://www.vg247.com/feed', source: 'VG247', category: 'general' },
  { url: 'https://www.nintendolife.com/feeds/latest', source: 'Nintendo Life', category: 'general' },
];

// 品类分类关键词全部来自 config/categories.ts 的 rssKeywords（单一事实来源），
// 按 CATEGORIES 的声明顺序依次匹配，命中即归入该品类；全部未命中则落桶到 general。
const CATEGORY_MATCHERS: { id: string; keywords: string[] }[] = CATEGORIES
  .filter((c) => c.rssKeywords.length > 0)
  .map((c) => ({ id: c.id, keywords: c.rssKeywords.map((k) => k.toLowerCase()) }));

function categorize(text: string): NewsCategory {
  const lower = text.toLowerCase();
  for (const { id, keywords } of CATEGORY_MATCHERS) {
    if (keywords.some((k) => lower.includes(k))) return id;
  }
  return GENERAL_CATEGORY.id;
}

export async function collectRSS(): Promise<NewsItem[]> {
  const items: NewsItem[] = [];

  for (const feed of FEEDS) {
    try {
      const result = await rssParser.parseURL(feed.url);
      if (!result.items) continue;

      for (const entry of result.items.slice(0, 30)) {
        const title = entry.title || '';
        const summary = entry.contentSnippet || entry.content || '';
        const category = categorize(title + ' ' + summary);
        const publishedAt = entry.pubDate ? new Date(entry.pubDate).getTime() : Date.now();

        items.push({
          id: `rss_${crypto.createHash('sha256').update(entry.link || title).digest('hex').slice(0, 16)}`,
          title,
          summary: summary.slice(0, 300),
          url: entry.link || '',
          source: feed.source,
          sourceType: 'rss',
          category,
          thumbnail: extractImage(entry),
          publishedAt,
          collectedAt: Date.now(),
        });
      }
    } catch (err) {
      console.error(`[RSS] Failed to fetch ${feed.source}:`, err);
    }
  }

  return items;
}

function extractImage(entry: any): string | undefined {
  if (entry.enclosure?.url) return entry.enclosure.url;
  const match = (entry.content || '').match(/<img[^>]+src="([^">]+)"/);
  return match?.[1];
}
