import fs from 'fs';
import path from 'path';
import { config } from './config.js';
import type { NewsItem, AccountInfo, SyncHistoryEntry } from './types.js';

interface DBShape {
  news: NewsItem[];
  accountInfo: AccountInfo;
  lastCollected: number | null;
  syncHistory: SyncHistoryEntry[];
  /** Preserved local-only snapshot from the former shared account store; never served by API. */
  legacySharedAccountInfo?: AccountInfo;
  legacySharedSyncHistory?: SyncHistoryEntry[];
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

export function defaultAccountInfo(): AccountInfo {
  return { ...defaultDB.accountInfo };
}

/**
 * 判断一份 accountInfo 是否真的「有内容」——逐字段与默认值比对，而不是只挑几个
 * 手写字段。漏字段会让只填了这些字段的旧共享统计不被搬进 legacy 槽，
 * `/api/ai/account/legacy-claim-status` 就永远报 available:false，用户拿不回数据。
 * contentFocus 的默认值本身非空，不能当「有数据」的证据，故跳过。
 */
export function hasMeaningfulAccountInfo(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const row = raw as Record<string, unknown>;
  const defaults = defaultDB.accountInfo as unknown as Record<string, unknown>;
  return Object.keys(defaults).some((key) => {
    if (key === 'contentFocus') return false;
    const value = row[key];
    if (value === undefined || value === null) return false;
    return value !== defaults[key];
  });
}

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
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const data = { ...defaultDB, ...parsed } as DBShape;
    // Before account isolation, accountInfo/history were global server state.
    // Preserve a local recovery copy, move them under an explicitly named legacy
    // field, and reset the active shared slot so no anonymous endpoint can expose it.
    const hasSharedAccount = hasMeaningfulAccountInfo(parsed.accountInfo);
    const hasSharedHistory = Array.isArray(parsed.syncHistory) && parsed.syncHistory.length > 0;
    if ((hasSharedAccount || hasSharedHistory) && !data.legacySharedAccountInfo && !data.legacySharedSyncHistory) {
      const backupPath = `${DB_PATH}.legacy-account-backup`;
      try {
        if (!fs.existsSync(backupPath)) fs.copyFileSync(DB_PATH, backupPath);
      } catch (backupErr) {
        // Do not discard the old fields if the recovery copy could not be made.
        console.error('[db] shared account backup failed; keeping legacy data in-place:', backupErr);
        return data;
      }
      data.legacySharedAccountInfo = data.accountInfo;
      data.legacySharedSyncHistory = data.syncHistory;
      data.accountInfo = defaultAccountInfo();
      data.syncHistory = [];
      writeDB(data);
    }
    return data;
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

export function migrateSharedAnalyticsToUserInfo(info: AccountInfo, history: SyncHistoryEntry[]): void {
  const data = readDB();
  data.legacySharedAccountInfo = info;
  data.legacySharedSyncHistory = history;
  data.accountInfo = defaultAccountInfo();
  data.syncHistory = [];
  writeDB(data);
}

/** Historic shared account slot, available only to the one-time authenticated claim path. */
export function getLegacySharedAccountAnalytics(): { accountInfo: AccountInfo; syncHistory: SyncHistoryEntry[] } {
  const data = readDB();
  return {
    accountInfo: data.legacySharedAccountInfo ?? defaultAccountInfo(),
    syncHistory: data.legacySharedSyncHistory ?? [],
  };
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

};
