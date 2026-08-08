import Dexie, { type Table } from 'dexie';
import type { Topic, Script } from '../types';

class CreatorDB extends Dexie {
  topics!: Table<Topic, string>;
  scripts!: Table<Script, string>;

  constructor() {
    super('CreatorStudio');
    this.version(1).stores({
      topics: 'id, category, status, createdAt',
      scripts: 'id, topicId, platform, version, createdAt',
    });
    // Version 2: added evaluation field to topics
    this.version(2).stores({
      topics: 'id, category, status, createdAt',
      scripts: 'id, topicId, platform, version, createdAt',
    }).upgrade(() => {
      // evaluation field is optional, no migration needed
    });
  }
}

export const db = new CreatorDB();
