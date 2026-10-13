import { create } from 'zustand';
import { db } from '../db';
import { scheduleSyncUpload } from '../services/syncService';
import type { BriefAttachment, ContentExperiment, GameMarketingBrief, MaterialFavorite } from '../types';

interface MarketingState {
  attachments: BriefAttachment[];
  favorites: MaterialFavorite[];
  experiments: ContentExperiment[];
  briefs: GameMarketingBrief[];
  loading: boolean;
  load: () => Promise<void>;
  replaceRemote: (experiments: ContentExperiment[], briefs: GameMarketingBrief[]) => Promise<void>;
  saveExperiment: (record: ContentExperiment) => Promise<void>;
  deleteExperiment: (id: string) => Promise<void>;
  saveBrief: (record: GameMarketingBrief) => Promise<void>;
  deleteBrief: (id: string) => Promise<void>;
  attachAsset: (briefId: string, assetId: string, note: string) => Promise<void>;
  detachAsset: (id: string) => Promise<void>;
  saveFavorite: (assetId: string, collection: string, note: string) => Promise<void>;
  removeFavorite: (id: string) => Promise<void>;
}

export const useMarketingStore = create<MarketingState>((set) => ({
  experiments: [],
  briefs: [],
  attachments: [],
  favorites: [],
  loading: false,
  load: async () => {
    set({ loading: true });
    try {
      const [workbench, attachments, favorites] = await Promise.all([
        db.marketingWorkbench.get('workspace'),
        db.briefAttachments.orderBy('createdAt').reverse().toArray(),
        db.materialFavorites.orderBy('createdAt').reverse().toArray(),
      ]);
      set({ experiments: workbench?.experiments ?? [], briefs: workbench?.briefs ?? [], attachments, favorites });
    } finally { set({ loading: false }); }
  },
  replaceRemote: async (experiments, briefs) => {
    const record = { id: 'workspace' as const, experiments, briefs, updatedAt: Date.now() };
    await db.marketingWorkbench.put(record);
    set({ experiments, briefs });
  },
  saveExperiment: async (record) => {
    const workbench = await db.transaction('rw', db.marketingWorkbench, async () => {
      const current = await db.marketingWorkbench.get('workspace') ?? { id: 'workspace' as const, experiments: [], briefs: [], updatedAt: Date.now() };
      const next = { ...current, experiments: [record, ...current.experiments.filter((item) => item.id !== record.id)], updatedAt: Date.now() };
      await db.marketingWorkbench.put(next);
      return next;
    });
    set({ experiments: workbench.experiments, briefs: workbench.briefs });
    scheduleSyncUpload();
  },
  deleteExperiment: async (id) => {
    const next = await db.transaction('rw', db.marketingWorkbench, async () => {
      const current = await db.marketingWorkbench.get('workspace');
      if (!current) return null;
      const updated = { ...current, experiments: current.experiments.filter((item) => item.id !== id), updatedAt: Date.now() };
      await db.marketingWorkbench.put(updated);
      return updated;
    });
    if (!next) return;
    set({ experiments: next.experiments, briefs: next.briefs });
    scheduleSyncUpload();
  },
  saveBrief: async (record) => {
    const next = await db.transaction('rw', db.marketingWorkbench, async () => {
      const current = await db.marketingWorkbench.get('workspace') ?? { id: 'workspace' as const, experiments: [], briefs: [], updatedAt: Date.now() };
      const updated = { ...current, briefs: [record, ...current.briefs.filter((item) => item.id !== record.id)], updatedAt: Date.now() };
      await db.marketingWorkbench.put(updated);
      return updated;
    });
    set({ experiments: next.experiments, briefs: next.briefs });
    scheduleSyncUpload();
  },
  deleteBrief: async (id) => {
    const next = await db.transaction('rw', db.marketingWorkbench, async () => {
      const current = await db.marketingWorkbench.get('workspace');
      if (!current) return null;
      const updated = { ...current, briefs: current.briefs.filter((item) => item.id !== id), updatedAt: Date.now() };
      await db.marketingWorkbench.put(updated);
      return updated;
    });
    if (!next) return;
    set({ experiments: next.experiments, briefs: next.briefs });
    scheduleSyncUpload();
  },
  attachAsset: async (briefId, assetId, note) => {
    const existing = await db.briefAttachments.where({ briefId, assetId }).first();
    if (existing) return;
    const attachment: BriefAttachment = { id: crypto.randomUUID(), briefId, assetId, note, createdAt: Date.now() };
    await db.briefAttachments.add(attachment);
    set((state) => ({ attachments: [attachment, ...state.attachments] }));
    scheduleSyncUpload();
  },
  detachAsset: async (id) => {
    await db.briefAttachments.delete(id);
    set((state) => ({ attachments: state.attachments.filter((item) => item.id !== id) }));
    scheduleSyncUpload();
  },
  saveFavorite: async (assetId, collection, note) => {
    const duplicate = await db.materialFavorites.where('assetId').equals(assetId).first();
    if (duplicate) {
      const updated = { ...duplicate, collection, note };
      await db.materialFavorites.put(updated);
      set((state) => ({ favorites: state.favorites.map((item) => item.id === duplicate.id ? updated : item) }));
    } else {
      const favorite: MaterialFavorite = { id: crypto.randomUUID(), assetId, collection, note, createdAt: Date.now() };
      await db.materialFavorites.add(favorite);
      set((state) => ({ favorites: [favorite, ...state.favorites] }));
    }
    scheduleSyncUpload();
  },
  removeFavorite: async (id) => {
    await db.materialFavorites.delete(id);
    set((state) => ({ favorites: state.favorites.filter((item) => item.id !== id) }));
    scheduleSyncUpload();
  },
}));
