import cron from 'node-cron';
import { config } from '../config.js';
import { db } from '../db.js';
import { collectRSS } from './collectors/rssCollector.js';
import { collectYouTube } from './collectors/youtubeCollector.js';
import { collectBilibili } from './collectors/bilibiliCollector.js';
import { translateTitles } from './aiService.js';
import { syncAccount } from './accountSyncService.js';

let isCollecting = false;

export async function collectAll(): Promise<{ total: number; sources: Record<string, number> }> {
  if (isCollecting) {
    console.log('[Scheduler] Already collecting, skipping');
    return { total: 0, sources: {} };
  }

  isCollecting = true;
  console.log('[Scheduler] Starting collection...');

  const sources: Record<string, number> = {};

  try {
    const [rssItems, youtubeItems, bilibiliItems] = await Promise.allSettled([
      collectRSS(),
      collectYouTube(),
      collectBilibili(),
    ]);

    let allItems: any[] = [];

    if (rssItems.status === 'fulfilled') {
      sources.rss = rssItems.value.length;
      allItems = allItems.concat(rssItems.value);
    } else {
      sources.rss = 0;
      console.error('[Scheduler] RSS failed:', rssItems.reason);
    }

    if (youtubeItems.status === 'fulfilled') {
      sources.youtube = youtubeItems.value.length;
      allItems = allItems.concat(youtubeItems.value);
    } else {
      sources.youtube = 0;
      console.error('[Scheduler] YouTube failed:', youtubeItems.reason);
    }

    if (bilibiliItems.status === 'fulfilled') {
      sources.bilibili = bilibiliItems.value.length;
      allItems = allItems.concat(bilibiliItems.value);
    } else {
      sources.bilibili = 0;
      console.error('[Scheduler] Bilibili failed:', bilibiliItems.reason);
    }

    const added = db.addNews(allItems);
    db.setLastCollected(Date.now());

    // Translate English titles for newly added items
    if (added > 0) {
      const newItems = allItems.filter((item) => !item.translatedTitle);
      if (newItems.length > 0) {
        try {
          const translations = await translateTitles(
            newItems.map((item) => ({ id: item.id, title: item.title })),
          );
          if (translations.size > 0) {
            db.updateTranslations(translations);
            console.log(`[Scheduler] Translated ${translations.size} titles`);
          }
        } catch (err) {
          console.error('[Scheduler] Translation failed:', err);
        }
      }
    }

    console.log(`[Scheduler] Collected ${allItems.length} items, added ${added} new`);
    return { total: added, sources };
  } finally {
    isCollecting = false;
  }
}

export function startScheduler(): void {
  if (cron.validate(config.collectInterval)) {
    cron.schedule(config.collectInterval, () => {
      collectAll().catch(console.error);
    });
    console.log(`[Scheduler] News collection scheduled: ${config.collectInterval}`);
  } else {
    console.warn(`[Scheduler] Invalid cron interval: ${config.collectInterval}`);
  }

  // 每天早上 8:00 自动同步账号数据
  cron.schedule('0 8 * * *', () => {
    console.log('[Scheduler] Daily account sync starting...');
    syncAccount().catch((err) => {
      console.error('[Scheduler] Account sync failed:', err);
    });
  });
  console.log('[Scheduler] Account sync scheduled: daily at 08:00');
}
