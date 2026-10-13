import { api, ApiError, setAuthToken, AUTH_TOKEN_KEY } from '../api/client';
import { db } from '../db';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';
import { useMarketingStore } from '../store/marketingStore';
import { useAssetStore } from '../store/assetStore';
import type { ContentExperiment, GameMarketingBrief } from '../types';

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

// ── 「本机有改动尚未上传」的持久标记 ────────────────────────
// 数据一变就排一次 5 秒防抖上传。如果在这 5 秒内同步流程走到「云端较新 → 整表覆盖本地」，
// 或者使用者直接关掉页面，这些改动就还没进云端。用 localStorage 记住这个事实，
// 让 syncDownload 先推送再覆盖，而不是把它们当成垃圾清掉。
const PENDING_KEY = 'syncPendingAt';

function hasStoredToken(): boolean {
  try {
    return localStorage.getItem(TOKEN_KEY) !== null;
  } catch {
    return false;
  }
}

function markPendingUpload(): void {
  try {
    localStorage.setItem(PENDING_KEY, String(Date.now()));
  } catch {
    // 隐私模式等写不了 localStorage 的场景：退化成「无法保证不丢」，不影响主流程
  }
}

function clearPendingUpload(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/** 本机是否存在「改动晚于上次同步」的待上传内容 */
export function hasPendingUpload(): boolean {
  try {
    const pendingAt = parseInt(localStorage.getItem(PENDING_KEY) || '0');
    if (!pendingAt) return false;
    const lastSyncAt = parseInt(localStorage.getItem('lastSyncAt') || '0');
    return pendingAt > lastSyncAt;
  } catch {
    return false;
  }
}

// Debounced upload — called after data changes
export function scheduleSyncUpload(): void {
  // 没登录时不必排上传：/sync/upload 必然 401。登录后 afterAuthSuccess() 会走
  // syncOnLaunch()，那条路径在「云端无内容」时会把本地数据整体推上去。
  if (!hasStoredToken()) return;
  markPendingUpload();
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    syncUpload().catch(console.error);
  }, 5000);
}

/** 立刻把防抖中的改动推上去（不等 5 秒）。返回 true 表示推送成功、本机不再有待上传改动。 */
export async function flushPendingUpload(): Promise<boolean> {
  if (uploadTimer) {
    clearTimeout(uploadTimer);
    uploadTimer = null;
  }
  if (!hasPendingUpload()) return false;
  if (isSyncing) return false;
  try {
    await syncUpload();
  } catch (err) {
    console.warn('[sync] 立即上传待同步改动失败：', err);
  }
  return !hasPendingUpload();
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
    const assets = withoutDemo(await db.assets.toArray());
    const materialFavorites = await db.materialFavorites.toArray();
    const briefAttachments = await db.briefAttachments.toArray();
    const marketingWorkbench = (await db.marketingWorkbench.get('workspace')) ?? { id: 'workspace' as const, experiments: [], briefs: [], updatedAt: Date.now() };
    const uploadedAt = Date.now();

    // 乐观锁：带上「上次同步到的云端时间戳」。
    // 若云端已被其它设备更新，后端返回 409 CONFLICT，我们放弃本次上传，
    // 避免用本机的旧数据把云端较新的数据覆盖掉。
    // 显式带上基准时间戳（0 也带上）：服务端把「缺 base」当成「不做乐观锁」，
    // 传 0 才能在云端已有内容时收到 409，而不是无保护地覆盖云端。
    const baseUploadedAt = parseInt(localStorage.getItem('lastSyncAt') || '0');

    await api.uploadSync({ topics, scripts, assets, materialFavorites, briefAttachments, marketingWorkbench, uploadedAt, baseUploadedAt });
    localStorage.setItem('lastSyncAt', String(uploadedAt));
    clearPendingUpload();
    console.log('[sync] Upload complete:', topics.length, 'topics,', scripts.length, 'scripts');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'CONFLICT') {
      console.warn('[sync] Cloud is newer (409 CONFLICT) — downloading instead of overwriting');
      // 冲突说明云端确实更新，本机改动推不上去了；先清待上传标记，
      // 否则 syncDownload 会再次尝试上传、形成回环。
      clearPendingUpload();
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

// ── 覆盖本地之后的 store 刷新 ────────────────────────────────
// db 被整表替换后，内存里的 store 必须一起重新加载：否则旧数组会让
// updateAsset/touchAsset 之类「读了再写」的操作把刚被删掉的行又写回 IndexedDB，
// 再被 scheduleSyncUpload 推到这个账号的云端（跨账号泄漏的一环）。
async function reloadSyncedStores(): Promise<void> {
  await Promise.all([
    useTopicStore.getState().loadTopics(),
    useScriptStore.getState().loadScripts(),
    useAssetStore.getState().loadAssets(),
    useMarketingStore.getState().load(),
  ]);
}

type CloudSnapshot = Awaited<ReturnType<typeof api.downloadSync>>;

/**
 * 把云端快照「并」进本地：同 id 以云端为准，本机独有的记录保留（绝不删除本机数据）。
 *
 * 只用于「本机数据从未和这个账号同步过」（lastSyncAt 为 0）的场景 —— 首次登录、
 * 或站点数据被清过。这时若沿用整表清空 + 回填，会把使用者在这个浏览器里匿名创作
 * 的内容整批静默抹掉；合并后本机独有的记录会被随后排的上传带进该账号。
 */
async function mergeCloudIntoLocal(cloud: CloudSnapshot): Promise<void> {
  const mergeById = <T extends { id: string }>(localRows: T[], cloudRows: T[]): T[] => {
    const map = new Map(localRows.map((row) => [row.id, row]));
    for (const row of cloudRows) map.set(row.id, row);
    return [...map.values()];
  };
  await db.transaction('rw', [db.topics, db.scripts, db.assets, db.marketingWorkbench, db.materialFavorites, db.briefAttachments], async () => {
    // bulkPut = 有则覆盖、无则新增，不删除本机已有的行
    if (cloud.topics.length > 0) await db.topics.bulkPut(cloud.topics);
    if (cloud.scripts.length > 0) await db.scripts.bulkPut(cloud.scripts);
    if (cloud.assets?.length) await db.assets.bulkPut(cloud.assets);
    if (cloud.materialFavorites?.length) await db.materialFavorites.bulkPut(cloud.materialFavorites);
    if (cloud.briefAttachments?.length) await db.briefAttachments.bulkPut(cloud.briefAttachments);
    const workbench = cloud.marketingWorkbench as { experiments?: ContentExperiment[]; briefs?: GameMarketingBrief[] } | undefined;
    if (workbench) {
      const local = await db.marketingWorkbench.get('workspace');
      await db.marketingWorkbench.put({
        id: 'workspace',
        experiments: mergeById(local?.experiments ?? [], workbench.experiments ?? []),
        briefs: mergeById(local?.briefs ?? [], workbench.briefs ?? []),
        updatedAt: cloud.uploadedAt,
      });
    }
  });
  await reloadSyncedStores();
}

// Download cloud data and restore to local IndexedDB
async function syncDownload(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    // 本机有还没推上去的改动时先推再拉。否则下面的「云端较新 → 清空本地」分支
    // 会把刚编辑、还没上传的内容整批丢掉。
    if (hasPendingUpload()) {
      isSyncing = false;
      const pushed = await flushPendingUpload();
      if (pushed) {
        console.log('[sync] 本机有未上传的改动，已先推送；本次不再拉取覆盖');
        return;
      }
      // 推不上去（离线 / 服务端拒绝）时绝不能继续走覆盖分支：宁可先保留本机数据。
      throw new Error('本机有尚未上传的改动，已暂停这次云端拉取以避免覆盖本机数据；请检查网络后重试');
    }

    const cloud = await api.downloadSync();

    // empty: 后端明确告知「查询成功但云端无数据」；
    // 若下载失败，api.downloadSync() 会直接抛错（502/503），不会走到这里，
    // 因此不会再出现「查询失败被当成云端为空 → 用本地空数据覆盖云端」。
    if (cloud.empty || !cloud.uploadedAt || cloud.uploadedAt === 0) {
      // Cloud has no data — if local has data, upload it
      const localTopics = withoutDemo(await db.topics.toArray());
      const localScripts = withoutDemo(await db.scripts.toArray());
      const localAssets = withoutDemo(await db.assets.toArray());
      const localMaterialFavorites = await db.materialFavorites.count();
      const localBriefAttachments = await db.briefAttachments.count();
      const localWorkbench = await db.marketingWorkbench.get('workspace');
      const localWorkbenchCount = (localWorkbench?.experiments.length ?? 0) + (localWorkbench?.briefs.length ?? 0);
      if (localTopics.length > 0 || localScripts.length > 0 || localAssets.length > 0 || localWorkbenchCount > 0 || localMaterialFavorites > 0 || localBriefAttachments > 0) {
        console.log('[sync] Cloud empty, uploading local data...');
        isSyncing = false;
        await syncUpload();
      }
      return;
    }

    const lastSyncAt = parseInt(localStorage.getItem('lastSyncAt') || '0');

    if (cloud.uploadedAt > lastSyncAt) {
      if (lastSyncAt === 0) {
        // 本机数据从来没和任何账号同步过（首次登录 / 站点数据被清过）。
        // 云端确实有内容，但本机也可能是匿名创作的真实内容 —— 不做整表清空，
        // 改成按 id 合并，再把本机独有的记录补传进这个账号。
        console.log('[sync] 本机数据尚未与账号关联，改为按 id 合并云端快照…', cloud.topics.length, 'topics,', cloud.scripts.length, 'scripts');
        await mergeCloudIntoLocal(cloud);
        localStorage.setItem('lastSyncAt', String(cloud.uploadedAt));
        scheduleSyncUpload();
        return;
      }

      // Cloud is newer — restore to local
      console.log('[sync] Cloud is newer, restoring...', cloud.topics.length, 'topics,', cloud.scripts.length, 'scripts');

        await db.transaction('rw', [db.topics, db.scripts, db.assets, db.marketingWorkbench, db.materialFavorites, db.briefAttachments], async () => {
        await db.topics.clear();
        await db.scripts.clear();
        await db.assets.clear();
        await db.marketingWorkbench.clear();
        await db.materialFavorites.clear();
        await db.briefAttachments.clear();
        if (cloud.topics.length > 0) await db.topics.bulkAdd(cloud.topics);
        if (cloud.scripts.length > 0) await db.scripts.bulkAdd(cloud.scripts);
        if (cloud.assets?.length) await db.assets.bulkAdd(cloud.assets);
        const workbench = cloud.marketingWorkbench as { experiments?: ContentExperiment[]; briefs?: GameMarketingBrief[] } | undefined;
        if (workbench) await db.marketingWorkbench.put({ id: 'workspace', experiments: workbench.experiments ?? [], briefs: workbench.briefs ?? [], updatedAt: cloud.uploadedAt });
        if (cloud.materialFavorites?.length) await db.materialFavorites.bulkAdd(cloud.materialFavorites);
        if (cloud.briefAttachments?.length) await db.briefAttachments.bulkAdd(cloud.briefAttachments);
      });

      localStorage.setItem('lastSyncAt', String(cloud.uploadedAt));
      clearPendingUpload();

      // Reload stores
      await reloadSyncedStores();
      const workbench = cloud.marketingWorkbench as { experiments?: ContentExperiment[]; briefs?: GameMarketingBrief[] } | undefined;
      await useMarketingStore.getState().replaceRemote(workbench?.experiments ?? [], workbench?.briefs ?? []);
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
