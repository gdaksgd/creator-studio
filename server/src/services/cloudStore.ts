import { supabase, isSupabaseConfigured, SYNC_TABLE } from './supabaseClient.js';

// ============================================
// 云端账号数据仓库
//
// 背景：Supabase 这边只有 anon key，没有建表权限，所以**不能**新增表；
// 只能复用既有的单行表 app_sync(id = 1)。原来 data 里直接放
// { topics, scripts }，现在升级为「账号制」的 v2 结构：
//
//   {
//     version: 2,
//     users:    [{ id, username, usernameKey, passwordHash, createdAt }],
//     accounts: { [userId]: { topics, scripts, uploadedAt } },
//     legacy?:  { topics, scripts, uploadedAt }   // 迁移前的老数据，永不对外开放
//   }
//
// 读到旧结构时会自动迁移：老数据进 legacy 字段（保留、不丢，但没有任何接口读它）。
// 所有写操作都在进程内串行化（单实例部署），避免注册/上传互相覆盖。
// ============================================

export const CLOUD_VERSION = 2;

/**
 * 账号级 AI 配置。
 * deepseekApiKey 落库前用 AUTH_SECRET 派生的密钥做 AES-256-GCM 加密（见 services/aiConfigStore.ts），
 * 明文只在服务端内存里出现，接口只回掩码。
 */
export interface CloudAiConfig {
  deepseekApiKey?: string;
  updatedAt?: number;
}

/** 单个账号自己的云端数据 */
export interface CloudAccountData {
  topics: unknown[];
  scripts: unknown[];
  assets?: unknown[];
  materialFavorites?: unknown[];
  briefAttachments?: unknown[];
  marketingWorkbench?: { experiments: unknown[]; briefs: unknown[] };
  uploadedAt: number;
  /**
   * 账号统计/同步历史的更新时间。**与 uploadedAt 严格分开**：uploadedAt 是内容同步的
   * 版本号（乐观锁 + 前端「云端是否比本地新」的判据），分析写入绝不能碰它，
   * 否则从未上传过内容的账号会变成「云端有新内容」而被前端清空本地数据。
   */
  analyticsUpdatedAt?: number;
  /** 该账号自己的 AI 配置；缺省表示用站点公共配置 */
  ai?: CloudAiConfig;
  /** Per-user platform account analytics; never stored in the former shared db.json slot. */
  accountInfo?: Record<string, unknown>;
  syncHistory?: unknown[];
}

/** 账号记录（口令只存 scrypt 摘要） */
export interface CloudUserRecord {
  id: string;
  username: string;
  /** 归一化（小写）后的用户名，用于唯一性判断 */
  usernameKey: string;
  passwordHash: string;
  createdAt: number;
}

/** 迁移前的老数据（全局一份），仅保留备查 */
export interface CloudLegacyData {
  topics: unknown[];
  scripts: unknown[];
  uploadedAt: number;
}

export interface CloudBlob {
  version: number;
  users: CloudUserRecord[];
  accounts: Record<string, CloudAccountData>;
  legacy?: CloudLegacyData;
  legacyAccountAnalyticsClaimedBy?: string;
}

export interface CloudSnapshot {
  blob: CloudBlob;
  /** 行级 uploaded_at（= 所有账号里最新的那个），只用于统计/展示 */
  uploadedAt: number;
  /** 云端还没有任何账号数据 */
  empty: boolean;
}

/** 带 HTTP 语义的错误：路由层直接按 status/code 返回 */
export class CloudError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'CloudError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function emptyBlob(): CloudBlob {
  return { version: CLOUD_VERSION, users: [], accounts: {} };
}

function assertConfigured(): void {
  if (!isSupabaseConfigured() || !supabase) {
    throw new CloudError(503, 'NOT_CONFIGURED', '云端同步未配置');
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeUser(raw: unknown): CloudUserRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'string' ? record.id : '';
  const username = typeof record.username === 'string' ? record.username : '';
  const passwordHash = typeof record.passwordHash === 'string' ? record.passwordHash : '';
  if (!id || !username || !passwordHash) return null;
  const usernameKey =
    typeof record.usernameKey === 'string' && record.usernameKey ? record.usernameKey : username.toLowerCase();
  return { id, username, usernameKey, passwordHash, createdAt: asNumber(record.createdAt, 0) };
}

function normalizeAiConfig(raw: unknown): CloudAiConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const ai: CloudAiConfig = {};
  if (typeof record.deepseekApiKey === 'string' && record.deepseekApiKey) {
    ai.deepseekApiKey = record.deepseekApiKey;
  }
  const updatedAt = asNumber(record.updatedAt, 0);
  if (updatedAt > 0) ai.updatedAt = updatedAt;
  return ai.deepseekApiKey ? ai : undefined;
}

function normalizeAccount(raw: unknown): CloudAccountData {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const account: CloudAccountData = {
    topics: asArray(record.topics),
    scripts: asArray(record.scripts),
    uploadedAt: asNumber(record.uploadedAt, 0),
    ...(Array.isArray(record.assets) ? { assets: record.assets } : {}),
    ...(Array.isArray(record.materialFavorites) ? { materialFavorites: record.materialFavorites } : {}),
    ...(Array.isArray(record.briefAttachments) ? { briefAttachments: record.briefAttachments } : {}),
    ...(record.marketingWorkbench && typeof record.marketingWorkbench === 'object' && !Array.isArray(record.marketingWorkbench) ? { marketingWorkbench: {
      experiments: Array.isArray((record.marketingWorkbench as Record<string, unknown>).experiments) ? (record.marketingWorkbench as Record<string, unknown>).experiments as unknown[] : [],
      briefs: Array.isArray((record.marketingWorkbench as Record<string, unknown>).briefs) ? (record.marketingWorkbench as Record<string, unknown>).briefs as unknown[] : [],
    } } : {}),
    ...(Array.isArray(record.experiments) ? { experiments: record.experiments } : {}),
    ...(Array.isArray(record.briefs) ? { briefs: record.briefs } : {}),
  };
  // AI 配置必须原样透传：读-改-写整份 blob 时漏掉它会把账号里的 Key 悄悄抹掉
  const ai = normalizeAiConfig(record.ai);
  if (ai) account.ai = ai;
  if (record.accountInfo && typeof record.accountInfo === 'object' && !Array.isArray(record.accountInfo)) {
    account.accountInfo = record.accountInfo as Record<string, unknown>;
  }
  if (Array.isArray(record.syncHistory)) account.syncHistory = record.syncHistory;
  // 同样要透传：它记录账号统计的更新时间，漏掉会在读-改-写时被抹平
  const analyticsUpdatedAt = asNumber(record.analyticsUpdatedAt, 0);
  if (analyticsUpdatedAt > 0) account.analyticsUpdatedAt = analyticsUpdatedAt;
  return account;
}

/** 把云端读到的任意形状归一化成 v2；旧形状迁移进 legacy */
export function normalizeBlob(raw: unknown): CloudBlob {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  if (asNumber(record.version, 0) === CLOUD_VERSION) {
    const blob: CloudBlob = {
      version: CLOUD_VERSION,
      users: asArray(record.users)
        .map(normalizeUser)
        .filter((user): user is CloudUserRecord => user !== null),
      accounts: {},
      ...(typeof record.legacyAccountAnalyticsClaimedBy === 'string' ? { legacyAccountAnalyticsClaimedBy: record.legacyAccountAnalyticsClaimedBy } : {}),
    };
    const rawAccounts = record.accounts;
    if (rawAccounts && typeof rawAccounts === 'object') {
      for (const [userId, value] of Object.entries(rawAccounts as Record<string, unknown>)) {
        if (!userId) continue;
        blob.accounts[userId] = normalizeAccount(value);
      }
    }
    if (record.legacy && typeof record.legacy === 'object') {
      const legacy = record.legacy as Record<string, unknown>;
      blob.legacy = {
        topics: asArray(legacy.topics),
        scripts: asArray(legacy.scripts),
        uploadedAt: asNumber(legacy.uploadedAt, 0),
      };
    }
    // Rolling upgrade from v2 without an analytics owner: if at most one
    // account exists, bind its former embedded analytics exactly to that account.
    if (!blob.legacyAccountAnalyticsClaimedBy && blob.users.length === 1) {
      const onlyUser = blob.users[0]!;
      const onlyAccount = blob.accounts[onlyUser.id];
      if (onlyAccount?.accountInfo || onlyAccount?.syncHistory?.length) {
        blob.legacyAccountAnalyticsClaimedBy = onlyUser.id;
      }
    }
    return blob;
  }

  // v1（老结构）：data 顶层就是 topics / scripts —— 迁移到 legacy，不再对外暴露
  const legacy: CloudLegacyData = {
    topics: asArray(record.topics),
    scripts: asArray(record.scripts),
    uploadedAt: asNumber(record.uploadedAt, 0),
  };
  const blob = emptyBlob();
  if (legacy.uploadedAt > 0 || legacy.topics.length > 0 || legacy.scripts.length > 0) {
    blob.legacy = legacy;
  }
  return blob;
}

// ---------- 进程内读缓存（单飞 + 1.5 秒） ----------
// 打开数据看板会同时打几个请求（/auth/me、/sync/download、/ai/account/overview…），
// 过去每个请求都独立去 Supabase 取同一行 —— 冷启动单次 0.35～2 秒，首屏因此经常超过 3 秒。
// 这里只做两件不改变写入语义的事：
//   · 单飞：并发到达的 readCloud() 共用同一次云端往返；
//   · 1.5 秒极短 TTL：把同一批首屏请求兜进同一次往返。
// 写入路径完全不受影响：updateCloud() 在写锁里用 fetchCloud() 直读云端，
// writeCloud() 成功后立刻作废缓存，所以「读-改-写」永远基于云端最新数据。
// 注意：readCloud() 返回的是**共享快照**，调用方不得就地修改（要改就走 updateCloud）。
const READ_CACHE_MS = 1500;
let readCache: { snapshot: CloudSnapshot; at: number } | null = null;
let readInFlight: Promise<CloudSnapshot> | null = null;
/** 每次写云端自增：用来丢弃「写入前发出、写入后才回来」的读，避免刚写完就读到旧快照 */
let readGeneration = 0;

/**
 * 云端读的重试参数。
 * 2026-10-14 的故障里 `TypeError: fetch failed`（TCP 通、TLS 被重置）是唯一错误形态，
 * 一次失败就让登录/注册/sync 全部 502，所以这里做等间隔递增的短重试：
 * 抖动（几百毫秒级）能自愈，持续性故障仍然如实报 502，不假装成功。
 */
const READ_ATTEMPTS = 3;
const READ_RETRY_DELAYS_MS = [300, 900];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 真去云端取一次（内部含短重试），不做任何进程内缓存 */
async function fetchCloud(): Promise<CloudSnapshot> {
  assertConfigured();

  for (let attempt = 1; ; attempt += 1) {
    const { data, error } = await supabase!
      .from(SYNC_TABLE)
      .select('data, uploaded_at')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.error(`[cloud] read failed (${attempt}/${READ_ATTEMPTS}):`, error.message);
      if (attempt >= READ_ATTEMPTS) {
        throw new CloudError(502, 'CLOUD_ERROR', '云端查询失败: ' + error.message);
      }
      await sleep(READ_RETRY_DELAYS_MS[attempt - 1] ?? 900);
      continue;
    }

    if (!data) {
      return { blob: emptyBlob(), uploadedAt: 0, empty: true };
    }

    const row = data as Record<string, unknown>;
    const blob = normalizeBlob(row.data);
    const uploadedAt = asNumber(row.uploaded_at, 0);
    const empty = blob.users.length === 0 && Object.keys(blob.accounts).length === 0 && !blob.legacy;
    return { blob, uploadedAt, empty };
  }
}

/** 读云端那一行（进程内单飞 + 1.5 秒缓存）。表里没行时返回空 blob（不是错误） */
export async function readCloud(): Promise<CloudSnapshot> {
  const cached = readCache;
  if (cached && Date.now() - cached.at < READ_CACHE_MS) return cached.snapshot;
  if (readInFlight) return readInFlight;

  const generation = readGeneration;
  const task: Promise<CloudSnapshot> = fetchCloud()
    .then((snapshot) => {
      // 这次读的过程中云端被写过：结果可能已经是旧的，照样返回（请求不该失败），但绝不进缓存
      if (generation === readGeneration) readCache = { snapshot, at: Date.now() };
      return snapshot;
    })
    .finally(() => {
      if (readInFlight === task) readInFlight = null;
    });
  readInFlight = task;
  return task;
}

/** 整体写回云端（行级 uploaded_at 取所有账号里最新的时间） */
export async function writeCloud(blob: CloudBlob): Promise<void> {
  assertConfigured();
  let latest = blob.legacy?.uploadedAt ?? 0;
  for (const account of Object.values(blob.accounts)) {
    if (account.uploadedAt > latest) latest = account.uploadedAt;
  }

  const { error } = await supabase!
    .from(SYNC_TABLE)
    .upsert({ id: 1, data: blob, uploaded_at: latest });

  if (error) {
    console.error('[cloud] write failed:', error.message);
    throw new CloudError(502, 'CLOUD_ERROR', '云端写入失败: ' + error.message);
  }

  // 刚写过：缓存里那一份一定旧了，立刻作废；并让还在飞的读不要回填
  readGeneration += 1;
  readCache = null;
}

// ---------- 进程内串行化 ----------
// 单实例部署（tsx 前台进程），用一条 promise 链把所有「读-改-写」串起来，
// 避免两个注册请求同时读到旧数据而互相覆盖。
let writeChain: Promise<unknown> = Promise.resolve();

/** 在写锁里执行一段「读-改-写」；mutator 抛错时不会写回 */
export function updateCloud<T>(mutator: (blob: CloudBlob) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    // 直读云端，绝不用进程内缓存 —— 否则并发写入可能基于旧快照互相覆盖
    const { blob } = await fetchCloud();
    const result = await mutator(blob);
    await writeCloud(blob);
    return result;
  });
  writeChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/** Seed legacy shared analytics for exactly one explicitly authenticated user. */
export function claimLegacyAccountAnalytics<T>(userId: string, legacy: {
  accountInfo: Record<string, unknown>;
  syncHistory: unknown[];
}): Promise<{ claimed: boolean; value?: T }> {
  return updateCloud((blob) => {
    if (blob.legacyAccountAnalyticsClaimedBy) return { claimed: false };
    const account = normalizeAccount(blob.accounts[userId]);
    const existing = account.accountInfo;
    const existingHasValues = !!existing && !!(
      existing.bilibiliUid || existing.douyinId || existing.lastSyncAt || existing.bilibiliFollowers ||
      existing.bilibiliAvgViews || existing.douyinFollowers || existing.douyinAvgViews || existing.totalVideos ||
      existing.bilibiliTotalLikes || existing.douyinTotalLikes
    );
    const legacyHasValues = Object.values(legacy.accountInfo).some((value) => value !== '' && value !== 0 && value !== null && value !== undefined);
    if (!legacyHasValues || existingHasValues) return { claimed: false, value: existing as T | undefined };
    account.accountInfo = legacy.accountInfo;
    account.syncHistory = legacy.syncHistory;
    blob.accounts[userId] = account;
    blob.legacyAccountAnalyticsClaimedBy = userId;
    return { claimed: true, value: legacy.accountInfo as T };
  });
}

export async function getLegacyAccountAnalyticsClaimStatus(): Promise<{ available: boolean; claimed: boolean }> {
  const { blob } = await readCloud();
  return { available: !blob.legacyAccountAnalyticsClaimedBy, claimed: !!blob.legacyAccountAnalyticsClaimedBy };
}
