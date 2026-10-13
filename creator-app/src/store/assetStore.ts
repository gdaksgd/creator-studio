import { create } from 'zustand';
import { db } from '../db';
import { scheduleSyncUpload } from '../services/syncService';
import type { LibraryAsset, LibraryAssetType } from '../types';

type NewAsset = Omit<LibraryAsset, 'id' | 'createdAt' | 'updatedAt'>;

interface AssetStore {
  assets: LibraryAsset[];
  loading: boolean;
  loadAssets: () => Promise<void>;
  addAsset: (input: NewAsset) => Promise<void>;
  updateAsset: (id: string, patch: Partial<Omit<LibraryAsset, 'id' | 'createdAt'>>) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
  findDuplicate: (url: string, type: LibraryAssetType) => LibraryAsset | undefined;
  touchAsset: (id: string) => Promise<void>;
}

export const useAssetStore = create<AssetStore>((set, get) => ({
  assets: [],
  loading: false,
  loadAssets: async () => {
    set({ loading: true });
    try {
      const assets = await db.assets.orderBy('updatedAt').reverse().toArray();
      set({ assets });
    } finally {
      set({ loading: false });
    }
  },
  findDuplicate: (url, type) => {
    const normalized = url.trim().replace(/\/$/, '').toLowerCase();
    return get().assets.find((asset) => asset.type === type && asset.url.trim().replace(/\/$/, '').toLowerCase() === normalized);
  },
  touchAsset: async (id) => {
    const asset = get().assets.find((item) => item.id === id);
    if (!asset) return;
    const updated = { ...asset, lastUsedAt: Date.now(), updatedAt: Date.now() };
    await db.assets.put(updated);
    set((state) => ({ assets: state.assets.map((item) => item.id === id ? updated : item) }));
    scheduleSyncUpload();
  },
  addAsset: async (input) => {
    const duplicate = get().findDuplicate(input.url, input.type);
    if (duplicate) throw new Error(`素材已存在：「${duplicate.title}」`);
    const now = Date.now();
    const asset: LibraryAsset = { ...input, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
    await db.assets.add(asset);
    set((state) => ({ assets: [asset, ...state.assets] }));
    scheduleSyncUpload();
  },
  updateAsset: async (id, patch) => {
    const current = get().assets.find((asset) => asset.id === id);
    if (!current) return;
    const updated = { ...current, ...patch, updatedAt: Date.now() };
    await db.assets.put(updated);
    set((state) => ({ assets: state.assets.map((asset) => asset.id === id ? updated : asset) }));
    scheduleSyncUpload();
  },
  deleteAsset: async (id) => {
    await db.assets.delete(id);
    set((state) => ({ assets: state.assets.filter((asset) => asset.id !== id) }));
    scheduleSyncUpload();
  },
}));
