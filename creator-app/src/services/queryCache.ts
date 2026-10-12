// ============================================================
//  远端数据的小时级缓存（资讯中心 / 分析报告）
//
//  为什么要这层缓存：
//  资讯由服务端定时采集（默认 COLLECT_INTERVAL=0 */6 * * *），报告来自
//  最近一次 B 站快照 —— 也就是说同一条数据在一小时内根本不会变，但每次
//  打开页面都要重传 364KB（资讯 500 条）和 32KB（报告）的 JSON，慢的是
//  这段传输，不是服务端（服务端本机实测 63ms / 17ms）。
//  用户要求：每小时回源一次即可，不要每次打开都拉。
//
//  行为：
//    · 缓存未过期且非强制 → 直接用缓存渲染，一个网络请求都不发
//    · 过期或强制刷新     → 回源，成功后写回缓存
//    · 回源失败但手里有旧缓存 → 用旧缓存渲染，错误交给调用方展示
//
//  缓存是**可丢弃数据**，所以单独一个 IndexedDB 库（CreatorStudioCache），
//  不挤进放选题/脚本的 CreatorStudio 库：那样就不必为缓存去改用户数据库的
//  版本号，也不会因为多开一个页签撞上 Dexie 的版本升级阻塞。
//  内存里再放一份热副本 → 同一次会话内切页面是同步命中，不发请求。
// ============================================================

import Dexie, { type Table } from 'dexie';

/** 回源间隔：一小时（用户明确要求「每小时获取一次」） */
export const CACHE_TTL_MS = 60 * 60 * 1000;

interface CacheRow {
  key: string;
  data: unknown;
  fetchedAt: number;
}

class CacheDB extends Dexie {
  entries!: Table<CacheRow, string>;

  constructor() {
    super('CreatorStudioCache');
    this.version(1).stores({ entries: 'key, fetchedAt' });
  }
}

const cacheDb = new CacheDB();

/** 会话级热副本：命中它就不必碰 IndexedDB（读取是同步的） */
const memory = new Map<string, { data: unknown; fetchedAt: number }>();

/** 缓存是否还在有效期内 */
export function isCacheFresh(fetchedAt: number | null | undefined, ttlMs: number = CACHE_TTL_MS): boolean {
  return typeof fetchedAt === 'number' && Date.now() - fetchedAt < ttlMs;
}

export async function readCache<T>(key: string): Promise<{ data: T; fetchedAt: number } | null> {
  const hot = memory.get(key);
  if (hot) return { data: hot.data as T, fetchedAt: hot.fetchedAt };
  try {
    const row = await cacheDb.entries.get(key);
    if (!row) return null;
    memory.set(key, { data: row.data, fetchedAt: row.fetchedAt });
    return { data: row.data as T, fetchedAt: row.fetchedAt };
  } catch (err) {
    // 隐私模式 / 存储被禁用：退化成「每次都回源」，不要因此让页面打不开
    console.warn('[cache] 读取本地缓存失败，本次按无缓存处理：', err);
    return null;
  }
}

export async function writeCache<T>(key: string, data: T): Promise<number> {
  const fetchedAt = Date.now();
  memory.set(key, { data, fetchedAt });
  try {
    await cacheDb.entries.put({ key, data, fetchedAt });
  } catch (err) {
    console.warn('[cache] 写入本地缓存失败（本次会话仍有内存缓存）：', err);
  }
  return fetchedAt;
}

/** 按前缀清缓存；不传前缀则全清。手动采集 / 重新翻译后必须调用 */
export async function clearCache(prefix?: string): Promise<void> {
  if (prefix === undefined) {
    memory.clear();
    try {
      await cacheDb.entries.clear();
    } catch (err) {
      console.warn('[cache] 清空本地缓存失败：', err);
    }
    return;
  }
  for (const key of [...memory.keys()]) {
    if (key.startsWith(prefix)) memory.delete(key);
  }
  try {
    await cacheDb.entries.where('key').startsWith(prefix).delete();
  } catch (err) {
    console.warn('[cache] 清理本地缓存失败：', err);
  }
}

export interface CacheResult<T> {
  /** 可渲染的数据（可能来自旧缓存）；回源失败且无缓存时为 null */
  data: T | null;
  fetchedAt: number | null;
  /** 本次是否没有发网络请求 */
  fromCache: boolean;
  /** 数据是否已经过了 TTL（回源失败时才会 true） */
  stale: boolean;
  error: unknown;
}

/**
 * 带缓存的取数：命中未过期缓存就不再回源。
 * 调用方拿到的永远是「能渲染就先渲染」的结果，网络错误通过 error 字段上报。
 */
export async function loadWithCache<T>(
  key: string,
  loader: () => Promise<T>,
  options: { force?: boolean; ttlMs?: number } = {},
): Promise<CacheResult<T>> {
  const cached = await readCache<T>(key);

  if (!options.force && cached && isCacheFresh(cached.fetchedAt, options.ttlMs)) {
    return { data: cached.data, fetchedAt: cached.fetchedAt, fromCache: true, stale: false, error: null };
  }

  try {
    const data = await loader();
    const fetchedAt = await writeCache(key, data);
    return { data, fetchedAt, fromCache: false, stale: false, error: null };
  } catch (error) {
    if (cached) {
      return { data: cached.data, fetchedAt: cached.fetchedAt, fromCache: true, stale: true, error };
    }
    return { data: null, fetchedAt: null, fromCache: false, stale: false, error };
  }
}
