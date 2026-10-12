import { api, ApiError, setAuthToken, AUTH_TOKEN_KEY } from '../api/client';
import { db } from '../db';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';

let uploadTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;

// ── 401（登录过期）处理 ──────────────────────────────────────
// /sync/upload、/sync/download 现在需要 Bearer token，缺/过期时后端返回 401 UNAUTHORIZED。
// ★ 401 不能当成一般的网络错误吞掉：必须清 token 并提示重新登录，
//   否则界面会一直显示「已登录」，而所有同步都静默失败。

/** token 的 localStorage 键名（唯一来源：api/client.ts），用来判断这次是不是「真的带着 token 过期了」 */
const TOKEN_KEY = AUTH_TOKEN_KEY;

type AuthExpiredHandler = () => void;
let authExpiredHandler: AuthExpiredHandler | null = null;

/**
 * UI 层（Layout）注册回调来弹 Toast —— 同步逻辑经常在非组件上下文里跑，
 * 拿不到 useToast()，所以用注册制；没人注册时只 console.warn。
 */
export function setAuthExpiredHandler(handler: AuthExpiredHandler | null): void {
  authExpiredHandler = handler;
}

function isUnauthorized(err: unknown): boolean {
  if (err instanceof ApiError && err.status === 401) return true;
  if (typeof err === 'object' && err !== null) {
    return (err as { code?: string }).code === 'UNAUTHORIZED';
  }
  return false;
}

/**
 * 统一处理 401：清 token + 只提示一次「登录已过期」。
 * 返回 true 表示「这确实是登录过期」，调用方不要再按网络错误处理。
 */
function handleUnauthorized(err: unknown): boolean {
  if (!isUnauthorized(err)) return false;
  const hadToken = (() => {
    try {
      return localStorage.getItem(TOKEN_KEY) !== null;
    } catch {
      return false;
    }
  })();
  setAuthToken(null);
  if (hadToken) {
    // 同一个 401 会沿调用栈冒泡，这里用「token 是否还在」保证只提示一次
    console.warn('[sync] 登录已过期，请重新登录');
    authExpiredHandler?.();
  }
  return true;
}

// Debounced upload — called after data changes
export function scheduleSyncUpload(): void {
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    syncUpload().catch(console.error);
  }, 5000);
}

// ── 演示数据不进云端 ────────────────────────────────────────
// 设置页的「载入演示数据」在已登录状态下也能点，而演示数据的 id 一律以 `demo-`
// 开头（见 services/demoData.ts）。为了兑现界面上「演示数据不会进入云端同步」
// 这句承诺，上传前把 demo- 记录过滤掉。下载侧不需要处理：云端永远不会有演示数据。
const DEMO_PREFIX = 'demo-';

function withoutDemo<T extends { id?: string }>(rows: T[]): T[] {
  return rows.filter((row) => !String(row.id ?? '').startsWith(DEMO_PREFIX));
}

// Upload all local data to cloud
async function syncUpload(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const topics = withoutDemo(await db.topics.toArray());
    const scripts = withoutDemo(await db.scripts.toArray());
    const uploadedAt = Date.now();

    // 乐观锁：带上「上次同步到的云端时间戳」。
    // 若云端已被其它设备更新，后端返回 409 CONFLICT，我们放弃本次上传，
    // 避免用本机的旧数据把云端较新的数据覆盖掉。
    const baseUploadedAt = parseInt(localStorage.getItem('lastSyncAt') || '0') || undefined;

    await api.uploadSync({ topics, scripts, uploadedAt, baseUploadedAt });
    localStorage.setItem('lastSyncAt', String(uploadedAt));
    console.log('[sync] Upload complete:', topics.length, 'topics,', scripts.length, 'scripts');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CONFLICT') {
      console.warn('[sync] Cloud is newer (409 CONFLICT) — downloading instead of overwriting');
      isSyncing = false;
      await syncDownload();
      return;
    }
    // 登录过期：清 token + 提示，并向上抛（不当作「上传失败」静默吞掉）
    if (handleUnauthorized(err)) throw err;
    console.error('[sync] Upload failed:', err);
  } finally {
    isSyncing = false;
  }
}

// Download cloud data and restore to local IndexedDB
async function syncDownload(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const cloud = await api.downloadSync();

    // empty: 后端明确告知「查询成功但云端无数据」；
    // 若下载失败，api.downloadSync() 会直接抛错（502/503），不会走到这里，
    // 因此不会再出现「查询失败被当成云端为空 → 用本地空数据覆盖云端」。
    if (cloud.empty || !cloud.uploadedAt || cloud.uploadedAt === 0) {
      // Cloud has no data — if local has data, upload it
      const localTopics = withoutDemo(await db.topics.toArray());
      const localScripts = withoutDemo(await db.scripts.toArray());
      if (localTopics.length > 0 || localScripts.length > 0) {
        console.log('[sync] Cloud empty, uploading local data...');
        isSyncing = false;
        await syncUpload();
      }
      return;
    }

    const lastSyncAt = parseInt(localStorage.getItem('lastSyncAt') || '0');

    if (cloud.uploadedAt > lastSyncAt) {
      // Cloud is newer — restore to local
      console.log('[sync] Cloud is newer, restoring...', cloud.topics.length, 'topics,', cloud.scripts.length, 'scripts');

      await db.topics.clear();
      await db.scripts.clear();

      if (cloud.topics.length > 0) await db.topics.bulkAdd(cloud.topics);
      if (cloud.scripts.length > 0) await db.scripts.bulkAdd(cloud.scripts);

      localStorage.setItem('lastSyncAt', String(cloud.uploadedAt));

      // Reload stores
      await useTopicStore.getState().loadTopics();
      await useScriptStore.getState().loadScripts();
    } else {
      console.log('[sync] Local is up to date');
    }
  } catch (err) {
    if (handleUnauthorized(err)) throw err;
    console.error('[sync] Download failed:', err);
  } finally {
    isSyncing = false;
  }
}

// Called on app launch
export async function syncOnLaunch(): Promise<void> {
  try {
    const status = await api.getSyncStatus();
    if (!status.syncConfigured) {
      console.log('[sync] Cloud sync not configured, skipping');
      return;
    }
    await syncDownload();
  } catch (err) {
    // 401 已在下层处理（清 token + 提示），这里不再重复报错
    if (handleUnauthorized(err)) return;
    console.error('[sync] Launch sync failed:', err);
  }
}

// Manual sync trigger
export async function manualSync(): Promise<{ uploaded: boolean; downloaded: boolean }> {
  const result = { uploaded: false, downloaded: false };
  try {
    const status = await api.getSyncStatus();
    if (!status.syncConfigured) {
      throw new Error('云端同步未配置');
    }

    const cloud = await api.downloadSync();
    const lastSyncAt = parseInt(localStorage.getItem('lastSyncAt') || '0');

    if (cloud.uploadedAt > lastSyncAt && cloud.uploadedAt > 0) {
      // Cloud is newer — download
      await syncDownload();
      result.downloaded = true;
    } else {
      // Local is newer or equal — upload
      isSyncing = false;
      await syncUpload();
      result.uploaded = true;
    }
  } catch (err) {
    // 登录过期时不按「同步失败」处理：清 token + 提示后照旧向上抛，
    // 调用方（设置页）可据此显示「登录已过期」。
    if (handleUnauthorized(err)) throw err;
    console.error('[sync] Manual sync failed:', err);
    throw err;
  }
  return result;
}
