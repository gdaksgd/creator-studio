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
  updateScript: (id: string, updates: Partial<Script>) => void;
  updateStoryboard: (scriptId: string, boardId: string, updates: Partial<Storyboard>) => void;
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

  updateScript: (id, updates) => {
    const now = Date.now();
    // 先同步更新内存，保证中文输入（IME 组字）时受控 value 即时回显，
    // 避免 await 延迟导致重渲染用旧值覆盖正在拼写的输入框。
    set((s) => ({
      scripts: s.scripts.map((sc) =>
        sc.id === id ? { ...sc, ...updates, updatedAt: now } : sc
      ),
    }));
    // 持久化改为 fire-and-forget，不阻塞 UI
    void db.scripts.update(id, { ...updates, updatedAt: now }).then(() => scheduleSyncUpload());
  },

  updateStoryboard: (scriptId, boardId, updates) => {
    const script = get().scripts.find((s) => s.id === scriptId);
    if (!script) return;
    const newBoards = script.storyboards.map((b) =>
      b.id === boardId ? { ...b, ...updates } : b
    );
    const now = Date.now();
    // 先同步更新内存（IME 友好），持久化 fire-and-forget
    set((s) => ({
      scripts: s.scripts.map((sc) =>
        sc.id === scriptId
          ? { ...sc, storyboards: newBoards, updatedAt: now }
          : sc
      ),
    }));
    void db.scripts
      .update(scriptId, { storyboards: newBoards, updatedAt: now })
      .then(() => scheduleSyncUpload());
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
