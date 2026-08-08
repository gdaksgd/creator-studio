import { api } from '../api/client';
import { db } from '../db';
import { useTopicStore } from '../store/topicStore';
import { useScriptStore } from '../store/scriptStore';

let uploadTimer: ReturnType<typeof setTimeout> | null = null;
let isSyncing = false;

// Debounced upload — called after data changes
export function scheduleSyncUpload(): void {
  if (uploadTimer) clearTimeout(uploadTimer);
  uploadTimer = setTimeout(() => {
    syncUpload().catch(console.error);
  }, 5000);
}

// Upload all local data to cloud
async function syncUpload(): Promise<void> {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const topics = await db.topics.toArray();
    const scripts = await db.scripts.toArray();
    const uploadedAt = Date.now();

    await api.uploadSync({ topics, scripts, uploadedAt });
    localStorage.setItem('lastSyncAt', String(uploadedAt));
    console.log('[sync] Upload complete:', topics.length, 'topics,', scripts.length, 'scripts');
  } catch (err) {
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

    if (!cloud.uploadedAt || cloud.uploadedAt === 0) {
      // Cloud has no data — if local has data, upload it
      const localTopics = await db.topics.toArray();
      const localScripts = await db.scripts.toArray();
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
    console.error('[sync] Manual sync failed:', err);
    throw err;
  }
  return result;
}
