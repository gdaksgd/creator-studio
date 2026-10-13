import Dexie, { type Table } from 'dexie';
import type { Topic, Script, LibraryAsset, MaterialFavorite, BriefAttachment, MarketingWorkbenchRecord } from '../types';

class CreatorDB extends Dexie {
  topics!: Table<Topic, string>;
  scripts!: Table<Script, string>;
  assets!: Table<LibraryAsset, string>;
  materialFavorites!: Table<MaterialFavorite, string>;
  briefAttachments!: Table<BriefAttachment, string>;
  marketingWorkbench!: Table<MarketingWorkbenchRecord, string>;

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
    this.version(3).stores({
      topics: 'id, category, status, createdAt, plannedPublishAt, productionDueAt',
      scripts: 'id, topicId, platform, version, createdAt',
      assets: 'id, type, category, createdAt, updatedAt',
    });
    this.version(4).stores({
      topics: 'id, category, status, createdAt, plannedPublishAt, productionDueAt',
      scripts: 'id, topicId, platform, version, createdAt',
      assets: 'id, type, category, createdAt, updatedAt, folder, relatedScriptId, favorite',
      materialFavorites: 'id, createdAt',
      briefAttachments: 'id, briefId, createdAt',
    });
    this.version(5).stores({
      topics: 'id, category, status, createdAt, plannedPublishAt, productionDueAt',
      scripts: 'id, topicId, platform, version, createdAt',
      assets: 'id, type, category, createdAt, updatedAt, folder, relatedScriptId, favorite',
      materialFavorites: 'id, createdAt',
      briefAttachments: 'id, briefId, createdAt',
      marketingWorkbench: 'id, updatedAt',
    });
    // Version 6: 补上营销工作台两个查询真正需要的索引
    //   - marketingStore.attachAsset() 用 db.briefAttachments.where({ briefId, assetId }) ⇒ 需要复合索引 [briefId+assetId]
    //   - marketingStore.saveFavorite() 用 db.materialFavorites.where('assetId')       ⇒ 需要 assetId 单键索引
    // 不能直接改 v5：v5 可能已经写进使用者的浏览器（构建已上线过一版），同版本号换 schema 会抛 Dexie SchemaError。
    this.version(6).stores({
      topics: 'id, category, status, createdAt, plannedPublishAt, productionDueAt',
      scripts: 'id, topicId, platform, version, createdAt',
      assets: 'id, type, category, createdAt, updatedAt, folder, relatedScriptId, favorite',
      materialFavorites: 'id, assetId, createdAt',
      briefAttachments: 'id, briefId, assetId, [briefId+assetId], createdAt',
      marketingWorkbench: 'id, updatedAt',
    });
  }
}

export const db = new CreatorDB();
