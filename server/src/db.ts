import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import type { NewsItem, AccountInfo, SyncHistoryEntry } from './types.js';

interface DBShape {
  news: NewsItem[];
  accountInfo: AccountInfo;
  lastCollected: number | null;
  syncHistory: SyncHistoryEntry[];
}

const DB_PATH = path.join(config.dataDir, 'db.json');

const defaultDB: DBShape = {
  news: [],
  accountInfo: {
    bilibiliFollowers: 0,
    bilibiliAvgViews: 0,
    douyinFollowers: 0,
    douyinAvgViews: 0,
    contentFocus: '卡牌游戏 + 恐怖游戏',
    daysActive: 0,
    totalVideos: 0,
    bilibiliUid: '',
    douyinId: '',
    lastSyncAt: 0,
    bilibiliName: '',
    bilibiliTotalLikes: 0,
    douyinName: '',
    douyinTotalVideos: 0,
    douyinTotalLikes: 0,
    syncMessage: '',
  },
  lastCollected: null,
  syncHistory: [],
};

function ensureDB(): void {
  if (!fs.existsSync(config.dataDir)) {
    fs.mkdirSync(config.dataDir, { recursive: true });
  }
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(defaultDB, null, 2), 'utf-8');
  }
}

function readDB(): DBShape {
  ensureDB();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return { ...defaultDB, ...JSON.parse(raw) };
  } catch {
    return { ...defaultDB };
  }
}

function writeDB(data: DBShape): void {
  ensureDB();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

export const db = {
  getNews(): NewsItem[] {
    return readDB().news.sort((a, b) => b.publishedAt - a.publishedAt);
  },

  addNews(items: NewsItem[]): number {
    const data = readDB();
    const existingUrls = new Set(data.news.map((n) => n.url));
    const newItems = items.filter((n) => !existingUrls.has(n.url));
    data.news = [...newItems, ...data.news].slice(0, 500);
    writeDB(data);
    return newItems.length;
  },

  markAsTopic(id: string): void {
    const data = readDB();
    const item = data.news.find((n) => n.id === id);
    if (item) {
      item.savedAsTopic = true;
      writeDB(data);
    }
  },

  clearNews(): void {
    const data = readDB();
    data.news = [];
    writeDB(data);
  },

  getAccountInfo(): AccountInfo {
    return readDB().accountInfo;
  },

  updateAccountInfo(info: Partial<AccountInfo>): AccountInfo {
    const data = readDB();
    data.accountInfo = { ...data.accountInfo, ...info };
    writeDB(data);
    return data.accountInfo;
  },

  setLastCollected(ts: number): void {
    const data = readDB();
    data.lastCollected = ts;
    writeDB(data);
  },

  updateTranslations(translations: Map<string, string>): void {
    const data = readDB();
    for (const item of data.news) {
      const translated = translations.get(item.id);
      if (translated) {
        item.translatedTitle = translated;
      }
    }
    writeDB(data);
  },

  getLastCollected(): number | null {
    return readDB().lastCollected;
  },

  getSyncHistory(): SyncHistoryEntry[] {
    return readDB().syncHistory.slice(-90); // Last 90 entries
  },

  addSyncHistory(entry: SyncHistoryEntry): void {
    const data = readDB();
    data.syncHistory.push(entry);
    // Keep last 90 entries
    if (data.syncHistory.length > 90) {
      data.syncHistory = data.syncHistory.slice(-90);
    }
    writeDB(data);
  },
};
