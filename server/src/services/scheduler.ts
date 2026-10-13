import cron from 'node-cron';
import { config } from '../config.js';
import { db } from '../db.js';
import { collectRSS } from './collectors/rssCollector.js';
import { collectYouTube } from './collectors/youtubeCollector.js';
import { collectBilibili } from './collectors/bilibiliCollector.js';
import { translateTitles } from './aiService.js';

let isCollecting = false;

// 轻量轮跑完后 30 分钟内不再跑，避免和完整轮（含 YouTube）贴在一起重复采集
const LIGHT_SKIP_MS = 30 * 60 * 1000;

export interface CollectResult {
  total: number;
  sources: Record<string, number>;
}

/**
 * 采集资讯。
 *
 * @param includeYouTube 是否包含 YouTube。**默认包含**——手动「立即采集」走的就是这条；
 *   定时任务里的轻量轮传 false，只跑 RSS + B站，避免每小时都吃 YouTube 配额。
 */
export async function collectAll(options: { includeYouTube?: boolean } = {}): Promise<CollectResult> {
  const includeYouTube = options.includeYouTube !== false;

  if (isCollecting) {
    console.log('[Scheduler] Already collecting, skipping');
    return { total: 0, sources: {} };
  }

  isCollecting = true;
  console.log(`[Scheduler] Starting collection${includeYouTube ? '' : ' (RSS + Bilibili only)'}...`);

  const sources: Record<string, number> = {};

  try {
    const jobs: { name: 'rss' | 'youtube' | 'bilibili'; run: () => Promise<any[]> }[] = [
      { name: 'rss', run: collectRSS },
      { name: 'bilibili', run: collectBilibili },
    ];
    if (includeYouTube) jobs.splice(1, 0, { name: 'youtube', run: collectYouTube });

    const settled = await Promise.allSettled(jobs.map((job) => job.run()));

    let allItems: any[] = [];

    settled.forEach((result, index) => {
      const name = jobs[index].name;
      if (result.status === 'fulfilled') {
        sources[name] = result.value.length;
        allItems = allItems.concat(result.value);
      } else {
        sources[name] = 0;
        console.error(`[Scheduler] ${name} failed:`, result.reason);
      }
    });

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

/**
 * 轻量轮：只采 RSS + B站（免费、无配额），用于「每小时都有新资讯」。
 * 若上一轮采集在 30 分钟内跑过（例如刚跑完含 YouTube 的完整轮）就跳过，不重复劳动。
 */
export async function collectLight(): Promise<CollectResult> {
  const lastCollected = db.getLastCollected();
  if (lastCollected && Date.now() - lastCollected < LIGHT_SKIP_MS) {
    console.log('[Scheduler] Light collection skipped (a round just ran)');
    return { total: 0, sources: {} };
  }
  return collectAll({ includeYouTube: false });
}

export function startScheduler(): void {
  if (cron.validate(config.collectInterval)) {
    cron.schedule(config.collectInterval, () => {
      collectAll().catch(console.error);
    });
    console.log(`[Scheduler] Full collection (RSS + YouTube + Bilibili) scheduled: ${config.collectInterval}`);
  } else {
    console.warn(`[Scheduler] Invalid cron interval: ${config.collectInterval}`);
  }

  if (config.lightCollectInterval && cron.validate(config.lightCollectInterval)) {
    cron.schedule(config.lightCollectInterval, () => {
      collectLight().catch(console.error);
    });
    console.log(`[Scheduler] Light collection (RSS + Bilibili) scheduled: ${config.lightCollectInterval}`);
  } else {
    console.warn(`[Scheduler] Light collection disabled (invalid or empty interval: '${config.lightCollectInterval}')`);
  }

  // Account analytics are now user-scoped; there is no longer a safe global
  // account sync job. Authenticated users trigger their own sync on demand.
}
