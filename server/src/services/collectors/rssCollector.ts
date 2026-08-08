import RSSParser from 'rss-parser';
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

// Card game patterns
const CARD_PATTERNS = [
  /卡牌/, /炉石/, /游戏王/, /万智牌/, /影之诗/, /七圣召唤/, /三国杀/,
  /hearthstone/i, /yugioh/i, /\bmtg\b/i, /\btcg\b/i, /\bccg\b/i,
  /trading card/i, /collectible card/i, /slay the spire/i, /杀戮尖塔/,
  /marvel snap/i, /gwent/i, /昆特牌/, /duel links/i, /master duel/i,
  /magic:? the gathering/i, /pok[eé]mon tcg/i, /ptcg/i, /宝可梦卡/,
  /legends of runeterra/i, /卡组/, /构筑/, /artifact(?! intelligence)/i,
  /shadowverse/i, /card game/i, /卡牌游戏/,
];

// Horror game patterns
const HORROR_PATTERNS = [
  /恐怖/, /惊悚/, /逃生/, /寂静岭/, /生化危机/, /恐鬼症/, /后室/,
  /\bhorror\b/i, /survival horror/i, /resident evil/i, /silent hill/i,
  /outlast/i, /phasmophobia/i, /backrooms/i, /five nights/i, /\bfnaf\b/i,
  /dead space/i, /死亡空间/, /恶灵/, /零:?濡鸦/, /零:?红蝶/,
  /amnesia:? the/i, /al(?:i|ie)n:? isolation/i, /黑暗.*恐怖/i,
  /\bscary\b/i, /凶宅/, /怨灵/, /鬼(?!谷)/,
];

function categorize(text: string): NewsCategory {
  if (CARD_PATTERNS.some((p) => p.test(text))) return 'card';
  if (HORROR_PATTERNS.some((p) => p.test(text))) return 'horror';
  return 'general';
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
          id: `rss_${Buffer.from(entry.link || title).toString('base64').slice(0, 16)}`,
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
