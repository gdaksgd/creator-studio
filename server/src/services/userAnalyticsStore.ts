import { defaultAccountInfo, getLegacySharedAccountAnalytics, hasMeaningfulAccountInfo, migrateSharedAnalyticsToUserInfo } from '../db.js';
import type { AccountInfo, SyncHistoryEntry } from '../types.js';
import { claimLegacyAccountAnalytics, readCloud, updateCloud } from './cloudStore.js';
import type { CloudAccountData } from './cloudStore.js';

function normalizeAccountInfo(raw: unknown): AccountInfo {
  const defaults = defaultAccountInfo();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;
  const row = raw as Record<string, unknown>;
  const numeric = (key: string, fallback: number) => {
    const value = Number(row[key]);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const text = (key: string, fallback: string) => typeof row[key] === 'string' ? row[key] as string : fallback;
  return {
    ...defaults,
    bilibiliFollowers: numeric('bilibiliFollowers', defaults.bilibiliFollowers),
    bilibiliAvgViews: numeric('bilibiliAvgViews', defaults.bilibiliAvgViews),
    douyinFollowers: numeric('douyinFollowers', defaults.douyinFollowers),
    douyinAvgViews: numeric('douyinAvgViews', defaults.douyinAvgViews),
    contentFocus: text('contentFocus', defaults.contentFocus),
    daysActive: numeric('daysActive', defaults.daysActive),
    totalVideos: numeric('totalVideos', defaults.totalVideos),
    bilibiliUid: text('bilibiliUid', ''),
    douyinId: text('douyinId', ''),
    lastSyncAt: numeric('lastSyncAt', 0),
    bilibiliName: text('bilibiliName', ''),
    bilibiliTotalLikes: numeric('bilibiliTotalLikes', 0),
    douyinName: text('douyinName', ''),
    douyinTotalVideos: numeric('douyinTotalVideos', 0),
    douyinTotalLikes: numeric('douyinTotalLikes', 0),
    syncMessage: text('syncMessage', ''),
  };
}

function normalizeHistory(raw: unknown): SyncHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(-90).filter((entry): entry is SyncHistoryEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const row = entry as Record<string, unknown>;
    return Number.isFinite(Number(row.timestamp));
  });
}

const TEXT_LIMIT = 500;

/**
 * 把请求体收敛成一份「合法字段 + 合法类型」的 AccountInfo 补丁：
 * 未知字段一律丢弃，超长字符串截断。写进云端的那一行 blob 是所有账号共用的，
 * 不能让任何登录用户塞进任意键/超长内容。
 */
export function sanitizeAccountInfoPatch(raw: unknown): Partial<AccountInfo> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const row = raw as Record<string, unknown>;
  const defaults = defaultAccountInfo() as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(defaults)) {
    if (!Object.prototype.hasOwnProperty.call(row, key)) continue;
    const value = row[key];
    if (typeof defaults[key] === 'number') {
      const num = Number(value);
      if (Number.isFinite(num) && num >= 0) patch[key] = num;
    } else {
      patch[key] = typeof value === 'string' ? value.slice(0, TEXT_LIMIT) : '';
    }
  }
  return patch as Partial<AccountInfo>;
}

/**
 * 只吃「请求里已经读到的账号切片」，不再自己去读云端。
 * optionalAuth / requireAuth 已经把整份快照读在手上，读接口再读一遍等于白等一次云端往返。
 */
export function accountInfoFromCloud(account: CloudAccountData | undefined): AccountInfo {
  return normalizeAccountInfo(account?.accountInfo);
}

/** 同上：同步历史也只吃已经读到的账号切片 */
export function syncHistoryFromCloud(account: CloudAccountData | undefined): SyncHistoryEntry[] {
  return normalizeHistory(account?.syncHistory);
}

export async function getUserAccountInfo(userId: string): Promise<AccountInfo> {
  const { blob } = await readCloud();
  return accountInfoFromCloud(blob.accounts[userId]);
}

export async function hasUserAccountAnalytics(userId: string): Promise<boolean> {
  const info = await getUserAccountInfo(userId);
  return !!(info.bilibiliUid || info.douyinId || info.lastSyncAt || info.bilibiliFollowers || info.totalVideos);
}

export async function updateUserAccountInfo(userId: string, updates: Partial<AccountInfo>): Promise<AccountInfo> {
  return updateCloud((blob) => {
    const account = blob.accounts[userId] ?? { topics: [], scripts: [], uploadedAt: 0 };
    const next = { ...normalizeAccountInfo(account.accountInfo), ...updates };
    account.accountInfo = next as unknown as Record<string, unknown>;
    // 这里绝不能动 uploadedAt —— 那是「内容同步」的版本号（sync 路由的乐观锁 + 前端
    // 「云端是否比本地新」的判据）。之前这里 bump uploadedAt，会让「只为统计写过一次、
    // 从未上传内容」的账号在云端出现 uploadedAt>0 且 topics/scripts 为空；前端
    // syncDownload() 于是判定云端更新、clear() 掉本地唯一一份内容，造成真实数据丢失。
    account.analyticsUpdatedAt = Date.now();
    blob.accounts[userId] = account;
    return next;
  });
}

export async function getUserSyncHistory(userId: string): Promise<SyncHistoryEntry[]> {
  const { blob } = await readCloud();
  return syncHistoryFromCloud(blob.accounts[userId]);
}

export async function getUserSyncStatus(userId: string): Promise<{ configured: boolean; updatedAt: number }> {
  const { blob } = await readCloud();
  const account = blob.accounts[userId];
  return { configured: !!account?.accountInfo, updatedAt: account?.analyticsUpdatedAt ?? 0 };
}

export async function addUserSyncHistory(userId: string, entry: SyncHistoryEntry): Promise<void> {
  await updateCloud((blob) => {
    const account = blob.accounts[userId] ?? { topics: [], scripts: [], uploadedAt: 0 };
    account.syncHistory = [...normalizeHistory(account.syncHistory), entry].slice(-90);
    // 同上：分析/历史的写入不参与内容同步的版本号。
    account.analyticsUpdatedAt = Date.now();
    blob.accounts[userId] = account;
  });
}

/** 遗留的「全站共享账号统计」是否真的有内容（用于认领卡片与认领校验）。 */
export function legacyAnalyticsHasData(): boolean {
  const legacy = getLegacySharedAccountAnalytics();
  return hasMeaningfulAccountInfo(legacy.accountInfo) || legacy.syncHistory.length > 0;
}

/**
 * 只有「最早注册的那个账号」才能认领历史共享统计。
 * 旧共享统计里含 B 站 UID/粉丝数，而注册是开放的 —— 若任何人先到先得，
 * 一个后注册的访客就能把站点主的运营数据认领走。
 */
export async function isLegacyClaimOwner(userId: string): Promise<boolean> {
  const { blob } = await readCloud();
  const claimedBy = blob.legacyAccountAnalyticsClaimedBy;
  if (claimedBy) return claimedBy === userId;
  const oldest = [...blob.users].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
  return !!oldest && oldest.id === userId;
}

/** User must explicitly claim the old shared server snapshot. It is assigned once globally. */
export async function claimLegacyAnalyticsForUser(userId: string): Promise<{ claimed: boolean }> {
  if (!(await isLegacyClaimOwner(userId))) return { claimed: false };
  const legacy = getLegacySharedAccountAnalytics();
  if (!legacyAnalyticsHasData()) return { claimed: false };
  const result = await claimLegacyAccountAnalytics<AccountInfo>(userId, {
    accountInfo: legacy.accountInfo as unknown as Record<string, unknown>,
    syncHistory: legacy.syncHistory,
  });
  if (result.claimed) migrateSharedAnalyticsToUserInfo(defaultAccountInfo(), []);
  return { claimed: result.claimed };
}
