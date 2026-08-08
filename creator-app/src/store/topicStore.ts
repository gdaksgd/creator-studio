import { create } from 'zustand';
import { db } from '../db';
import { scheduleSyncUpload } from '../services/syncService';
import type { Topic, GameCategory, TopicStatus } from '../types';

interface TopicStore {
  topics: Topic[];
  loading: boolean;
  loadTopics: () => Promise<void>;
  addTopic: (topic: Omit<Topic, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  updateTopic: (id: string, updates: Partial<Topic>) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
  getTopicsByCategory: (category: GameCategory) => Topic[];
  getTopicsByStatus: (status: TopicStatus) => Topic[];
}

export const useTopicStore = create<TopicStore>((set, get) => ({
  topics: [],
  loading: false,

  loadTopics: async () => {
    set({ loading: true });
    const topics = await db.topics.orderBy('createdAt').reverse().toArray();
    set({ topics, loading: false });
  },

  addTopic: async (input) => {
    const topic: Topic = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await db.topics.add(topic);
    set((s) => ({ topics: [topic, ...s.topics] }));
    scheduleSyncUpload();
  },

  updateTopic: async (id, updates) => {
    await db.topics.update(id, { ...updates, updatedAt: Date.now() });
    set((s) => ({
      topics: s.topics.map((t) =>
        t.id === id ? { ...t, ...updates, updatedAt: Date.now() } : t
      ),
    }));
    scheduleSyncUpload();
  },

  deleteTopic: async (id) => {
    await db.topics.delete(id);
    set((s) => ({ topics: s.topics.filter((t) => t.id !== id) }));
    scheduleSyncUpload();
  },

  getTopicsByCategory: (category) => {
    return get().topics.filter((t) => t.category === category);
  },

  getTopicsByStatus: (status) => {
    return get().topics.filter((t) => t.status === status);
  },
}));
