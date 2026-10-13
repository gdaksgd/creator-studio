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
  replaceStoryboards: (scriptId: string, boards: Storyboard[]) => Promise<void>;
  addStoryboard: (scriptId: string) => Promise<void>;
  removeStoryboard: (scriptId: string, boardId: string) => Promise<void>;
  reorderStoryboards: (scriptId: string, boardIds: string[]) => Promise<void>;
  deleteScript: (id: string) => Promise<void>;
  flushPendingWrites: () => void;
  saveRevision: (id: string, label?: string) => Promise<void>;
  restoreRevision: (id: string, revisionId: string) => Promise<void>;
}

export const useScriptStore = create<ScriptStore>((set, get) => {
  // Keep keystrokes responsive in memory, but coalesce IndexedDB writes while the
  // user is typing. This avoids one disk write + sync debounce per character.
  const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const persistScriptSoon = (id: string) => {
    const previous = persistTimers.get(id);
    if (previous) clearTimeout(previous);
    persistTimers.set(id, setTimeout(() => {
      persistTimers.delete(id);
      const latest = get().scripts.find((script) => script.id === id);
      if (!latest) return;
      void db.scripts.put(latest).then(() => scheduleSyncUpload());
    }, 350));
  };
  const flushPendingWrites = () => {
    for (const [id, timer] of persistTimers) {
      clearTimeout(timer);
      const latest = get().scripts.find((script) => script.id === id);
      if (latest) void db.scripts.put(latest).then(() => scheduleSyncUpload());
    }
    persistTimers.clear();
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushPendingWrites);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushPendingWrites();
    });
  }

  return ({
  scripts: [],
  loading: false,
  flushPendingWrites,
  saveRevision: async (id, label = '手动保存') => {
    const script = get().scripts.find((item) => item.id === id);
    if (!script) return;
    const revision = {
      id: crypto.randomUUID(),
      savedAt: Date.now(),
      label,
      title: script.title,
      hook: script.hook,
      storyboards: script.storyboards.map((board) => ({ ...board })),
      notes: script.notes,
      ...(script.platformCheck ? { platformCheck: { ...script.platformCheck } } : {}),
    };
    const history = [...(script.history ?? []), revision].slice(-50);
    const updated = { ...script, history, updatedAt: Date.now() };
    set((state) => ({ scripts: state.scripts.map((item) => item.id === id ? updated : item) }));
    await db.scripts.put(updated);
    scheduleSyncUpload();
  },
  restoreRevision: async (id, revisionId) => {
    const script = get().scripts.find((item) => item.id === id);
    const revision = script?.history?.find((item) => item.id === revisionId);
    if (!script || !revision) return;
    const now = Date.now();
    const rollback = {
      id: crypto.randomUUID(),
      savedAt: now,
      label: '恢复前自动快照',
      title: script.title,
      hook: script.hook,
      storyboards: script.storyboards.map((board) => ({ ...board })),
      notes: script.notes,
      ...(script.platformCheck ? { platformCheck: { ...script.platformCheck } } : {}),
    };
    const updated = {
      ...script,
      title: revision.title,
      hook: revision.hook,
      storyboards: revision.storyboards.map((board) => ({ ...board })),
      notes: revision.notes,
      ...(revision.platformCheck ? { platformCheck: { ...revision.platformCheck } } : { platformCheck: undefined }),
      history: [...(script.history ?? []), rollback].slice(-50),
      updatedAt: now,
    };
    set((state) => ({ scripts: state.scripts.map((item) => item.id === id ? updated : item) }));
    await db.scripts.put(updated);
    scheduleSyncUpload();
  },

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
    persistScriptSoon(id);
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
    persistScriptSoon(scriptId);
  },

  replaceStoryboards: async (scriptId, boards) => {
    const script = get().scripts.find((item) => item.id === scriptId);
    if (!script) return;
    const normalized = boards.map((board, index) => ({ ...board, sceneNumber: index + 1 }));
    const now = Date.now();
    const timer = persistTimers.get(scriptId);
    if (timer) clearTimeout(timer);
    persistTimers.delete(scriptId);
    const updated = { ...script, storyboards: normalized, updatedAt: now };
    set((state) => ({ scripts: state.scripts.map((item) => item.id === scriptId ? updated : item) }));
    await db.scripts.put(updated);
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
  });
});
