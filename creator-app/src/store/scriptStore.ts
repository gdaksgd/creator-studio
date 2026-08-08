import { create } from 'zustand';
import { db } from '../db';
import { scheduleSyncUpload } from '../services/syncService';
import type { Script, Storyboard, Platform } from '../types';

interface ScriptStore {
  scripts: Script[];
  loading: boolean;
  loadScripts: () => Promise<void>;
  getScriptsByTopic: (topicId: string) => Script[];
  createScript: (topicId: string, platform: Platform, version: 'long' | 'short') => Promise<Script>;
  updateScript: (id: string, updates: Partial<Script>) => Promise<void>;
  updateStoryboard: (scriptId: string, boardId: string, updates: Partial<Storyboard>) => Promise<void>;
  addStoryboard: (scriptId: string) => Promise<void>;
  removeStoryboard: (scriptId: string, boardId: string) => Promise<void>;
  reorderStoryboards: (scriptId: string, boardIds: string[]) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
}

export const useScriptStore = create<ScriptStore>((set, get) => ({
  scripts: [],
  loading: false,

  loadScripts: async () => {
    set({ loading: true });
    const scripts = await db.scripts.orderBy('createdAt').reverse().toArray();
    set({ scripts, loading: false });
  },

  getScriptsByTopic: (topicId) => {
    return get().scripts.filter((s) => s.topicId === topicId);
  },

  createScript: async (topicId, platform, version) => {
    const script: Script = {
      id: crypto.randomUUID(),
      topicId,
      platform,
      version,
      title: '',
      hook: '',
      storyboards: [],
      notes: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.scripts.add(script);
    set((s) => ({ scripts: [script, ...s.scripts] }));
    scheduleSyncUpload();
    return script;
  },

  updateScript: async (id, updates) => {
    await db.scripts.update(id, { ...updates, updatedAt: Date.now() });
    set((s) => ({
      scripts: s.scripts.map((sc) =>
        sc.id === id ? { ...sc, ...updates, updatedAt: Date.now() } : sc
      ),
    }));
    scheduleSyncUpload();
  },

  updateStoryboard: async (scriptId, boardId, updates) => {
    const script = get().scripts.find((s) => s.id === scriptId);
    if (!script) return;
    const newBoards = script.storyboards.map((b) =>
      b.id === boardId ? { ...b, ...updates } : b
    );
    await db.scripts.update(scriptId, { storyboards: newBoards, updatedAt: Date.now() });
    set((s) => ({
      scripts: s.scripts.map((sc) =>
        sc.id === scriptId
          ? { ...sc, storyboards: newBoards, updatedAt: Date.now() }
          : sc
      ),
    }));
    scheduleSyncUpload();
  },

  addStoryboard: async (scriptId) => {
    const script = get().scripts.find((s) => s.id === scriptId);
    if (!script) return;
    const newBoard: Storyboard = {
      id: crypto.randomUUID(),
      sceneNumber: script.storyboards.length + 1,
      description: '',
      dialogue: '',
      duration: 30,
      notes: '',
      visualDirection: '',
    };
    const newBoards = [...script.storyboards, newBoard];
    await db.scripts.update(scriptId, { storyboards: newBoards, updatedAt: Date.now() });
    set((s) => ({
      scripts: s.scripts.map((sc) =>
        sc.id === scriptId
          ? { ...sc, storyboards: newBoards, updatedAt: Date.now() }
          : sc
      ),
    }));
    scheduleSyncUpload();
  },

  removeStoryboard: async (scriptId, boardId) => {
    const script = get().scripts.find((s) => s.id === scriptId);
    if (!script) return;
    const newBoards = script.storyboards
      .filter((b) => b.id !== boardId)
      .map((b, i) => ({ ...b, sceneNumber: i + 1 }));
    await db.scripts.update(scriptId, { storyboards: newBoards, updatedAt: Date.now() });
    set((s) => ({
      scripts: s.scripts.map((sc) =>
        sc.id === scriptId
          ? { ...sc, storyboards: newBoards, updatedAt: Date.now() }
          : sc
      ),
    }));
    scheduleSyncUpload();
  },

  reorderStoryboards: async (scriptId, boardIds) => {
    const script = get().scripts.find((s) => s.id === scriptId);
    if (!script) return;
    const boards = script.storyboards;
    const newBoards = boardIds
      .map((id, i) => {
        const board = boards.find((b) => b.id === id);
        return board ? { ...board, sceneNumber: i + 1 } : null;
      })
      .filter(Boolean) as Storyboard[];
    await db.scripts.update(scriptId, { storyboards: newBoards, updatedAt: Date.now() });
    set((s) => ({
      scripts: s.scripts.map((sc) =>
        sc.id === scriptId
          ? { ...sc, storyboards: newBoards, updatedAt: Date.now() }
          : sc
      ),
    }));
    scheduleSyncUpload();
  },

  deleteScript: async (id) => {
    await db.scripts.delete(id);
    set((s) => ({ scripts: s.scripts.filter((sc) => sc.id !== id) }));
    scheduleSyncUpload();
  },
}));
