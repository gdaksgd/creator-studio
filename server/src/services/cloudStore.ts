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
  uploadedAt: number;
  /** 该账号自己的 AI 配置；缺省表示用站点公共配置 */
  ai?: CloudAiConfig;
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
  };
  // AI 配置必须原样透传：读-改-写整份 blob 时漏掉它会把账号里的 Key 悄悄抹掉
  const ai = normalizeAiConfig(record.ai);
  if (ai) account.ai = ai;
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

/** 读云端那一行。表里没行时返回空 blob（不是错误） */
export async function readCloud(): Promise<CloudSnapshot> {
  assertConfigured();
  const { data, error } = await supabase!
    .from(SYNC_TABLE)
    .select('data, uploaded_at')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('[cloud] read failed:', error.message);
    throw new CloudError(502, 'CLOUD_ERROR', '云端查询失败: ' + error.message);
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
}

// ---------- 进程内串行化 ----------
// 单实例部署（tsx 前台进程），用一条 promise 链把所有「读-改-写」串起来，
// 避免两个注册请求同时读到旧数据而互相覆盖。
let writeChain: Promise<unknown> = Promise.resolve();

/** 在写锁里执行一段「读-改-写」；mutator 抛错时不会写回 */
export function updateCloud<T>(mutator: (blob: CloudBlob) => T | Promise<T>): Promise<T> {
  const run = writeChain.then(async () => {
    const { blob } = await readCloud();
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
