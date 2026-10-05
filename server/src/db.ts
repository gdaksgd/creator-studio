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
    atomicWriteFile(DB_PATH, JSON.stringify(defaultDB, null, 2));
  }
}

// 原子写入：先写同目录临时文件 -> fsync 落盘 -> rename 覆盖目标。
// rename 在同一文件系统内是原子的，所以进程崩溃/断电时，
// db.json 要么是旧的完整内容，要么是新的完整内容，不会出现半截 JSON。
// 基准线缓存（benchmarkService）复用同一个实现。
export function atomicWriteFile(targetPath: string, payload: string): void {
  const tmpPath = `${targetPath}.tmp`;
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmpPath, 'w');
    fs.writeFileSync(fd, payload, 'utf-8');
    // 确保数据真正落到磁盘后再 rename，否则断电时可能 rename 了一个空文件
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    console.error(`[db] atomic write failed for ${targetPath}:`, err);
    throw err;
  }
}

function readDB(): DBShape {
  ensureDB();
  try {
    const raw = fs.readFileSync(DB_PATH, 'utf-8');
    return { ...defaultDB, ...JSON.parse(raw) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[db] readDB failed, falling back to defaults. ${DB_PATH}: ${message}`);
    // 解析失败（文件损坏/被截断）时先把坏文件改名留存，避免它被下一次写入
    // 直接覆盖 —— 否则用户的数据就无声消失了。保留现场便于人工恢复。
    try {
      if (fs.existsSync(DB_PATH)) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const corruptPath = `${DB_PATH}.corrupt-${stamp}`;
        fs.renameSync(DB_PATH, corruptPath);
        console.error(`[db] corrupt db.json preserved as ${corruptPath}`);
      }
    } catch (backupErr) {
      console.error('[db] failed to preserve corrupt db.json:', backupErr);
    }
    return { ...defaultDB };
  }
}

function writeDB(data: DBShape): void {
  ensureDB();
  atomicWriteFile(DB_PATH, JSON.stringify(data, null, 2));
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

  clearTranslations(): void {
    const data = readDB();
    for (const item of data.news) {
      delete item.translatedTitle;
    }
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
