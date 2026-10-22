import { PLATFORM_LABELS } from '../config/productionPipeline';
import type {
  AssetLicense,
  AssetMatchStatus,
  AssetRightsStatus,
  AssetSlot,
  AssetSlotAssetSnapshot,
  AssetSlotKind,
  AssetSourceType,
  LibraryAsset,
  LibraryAssetType,
  Platform,
} from '../types';

export const ASSET_SOURCE_LABELS: Record<AssetSourceType, string> = {
  local: '本地文件',
  stock: '素材/图库',
  ai: 'AI 生成',
  original: '原创',
};

export const ASSET_LICENSE_LABELS: Record<AssetLicense, string> = {
  own: '自有版权',
  licensed: '已授权',
  cc: 'CC/公共许可',
  unknown: '未记录授权',
};

export const ASSET_MATCH_LABELS: Record<AssetMatchStatus, string> = {
  unmatched: '未关联素材库',
  suggested: '有建议匹配',
  matched: '已关联素材库',
  missing: '素材缺失',
};

export const ASSET_RIGHTS_META: Record<
  AssetRightsStatus,
  { label: string; variant: 'success' | 'warning' | 'danger' | 'neutral'; description: string }
> = {
  ok: {
    label: '授权可核验',
    variant: 'success',
    description: '授权类型、到期和平台范围满足当前任务。',
  },
  unknown: {
    label: '授权未记录',
    variant: 'warning',
    description: '缺少授权类型或平台范围，不能当作已获授权。',
  },
  expired: {
    label: '授权已过期',
    variant: 'danger',
    description: '授权到期时间早于当前时间。',
  },
  platform_blocked: {
    label: '平台不允许',
    variant: 'danger',
    description: '该素材的允许平台不包含当前任务平台。',
  },
};

export interface AssetRightsLike {
  sourceType?: AssetSourceType;
  license?: AssetLicense;
  expiresAt?: number;
  allowedPlatforms?: Platform[];
}

/**
 * 纯函数：按当前平台与时间判断素材授权状态。
 * - 未记录授权类型 => unknown
 * - 已授权但没记允许平台 => unknown（不能猜平台范围）
 * - 自有版权忽略到期；其他授权到期则 expired
 * - 记录了允许平台但不包含目标平台 => platform_blocked
 */
export function evaluateAssetRights(
  asset: AssetRightsLike | undefined,
  platform: Platform,
  now = Date.now(),
): AssetRightsStatus {
  if (!asset) return 'unknown';
  const license = asset.license;
  if (!license || license === 'unknown') return 'unknown';
  if (license !== 'own' && asset.expiresAt !== undefined && asset.expiresAt < now) {
    return 'expired';
  }
  if (license === 'licensed' && (!asset.allowedPlatforms || !asset.allowedPlatforms.length)) {
    return 'unknown';
  }
  if (
    asset.allowedPlatforms?.length &&
    !asset.allowedPlatforms.includes(platform)
  ) {
    return 'platform_blocked';
  }
  return 'ok';
}

/** 素材库卡片没有目标平台，只能判断授权本身是否有记录/过期。 */
export function evaluateLibraryAssetRights(
  asset: AssetRightsLike,
  now = Date.now(),
): AssetRightsStatus {
  if (!asset.license || asset.license === 'unknown') return 'unknown';
  if (asset.license !== 'own' && asset.expiresAt !== undefined && asset.expiresAt < now) {
    return 'expired';
  }
  if (asset.license === 'licensed' && (!asset.allowedPlatforms || !asset.allowedPlatforms.length)) {
    return 'unknown';
  }
  return 'ok';
}

export function getSlotRightsStatus(
  slot: AssetSlot,
  platform: Platform,
  now = Date.now(),
): AssetRightsStatus {
  if (!slot.assetId) return 'unknown';
  // 素材库记录被删除/找不到时，保留旧快照只用于展示，授权状态不能继续算通过。
  if (slot.matchStatus === 'missing') return 'unknown';
  return evaluateAssetRights(slot.assetSnapshot, platform, now);
}

export function getSlotMatchStatus(slot: AssetSlot): AssetMatchStatus {
  if (slot.assetId) return 'matched';
  return slot.status === 'missing' ? 'missing' : 'unmatched';
}

export function assetSnapshotFromLibrary(asset: LibraryAsset): AssetSlotAssetSnapshot {
  return {
    id: asset.id,
    title: asset.title,
    url: asset.url,
    ...(asset.sourceType ? { sourceType: asset.sourceType } : {}),
    ...(asset.license ? { license: asset.license } : {}),
    ...(asset.licenseUrl ? { licenseUrl: asset.licenseUrl } : {}),
    ...(asset.expiresAt !== undefined ? { expiresAt: asset.expiresAt } : {}),
    ...(asset.allowedPlatforms?.length ? { allowedPlatforms: [...asset.allowedPlatforms] } : {}),
    ...(asset.checksum ? { checksum: asset.checksum } : {}),
  };
}

export function assetTypeMatchesSlot(kind: AssetSlotKind, type: LibraryAssetType): boolean {
  if (kind === 'unspecified' || kind === 'other') return true;
  if (kind === 'video') return type === 'video';
  if (kind === 'image') return type === 'image';
  if (kind === 'audio') return type === 'audio';
  if (kind === 'graphic') return type === 'image' || type === 'link' || type === 'document';
  return true;
}

export function slotKindFromAssetType(type: LibraryAssetType): AssetSlotKind {
  if (type === 'image') return 'image';
  if (type === 'video') return 'video';
  if (type === 'audio') return 'audio';
  return 'other';
}

/** 只做建议：类型 + 标签 + 关键词 + 同脚本关联，不自动认定。 */
export function suggestAssetsForSlot(
  slot: Pick<AssetSlot, 'kind' | 'description' | 'visualDirection'>,
  assets: LibraryAsset[],
  scriptId?: string,
): LibraryAsset[] {
  const slotText = `${slot.description} ${slot.visualDirection}`.toLocaleLowerCase();
  const words = [...new Set(slotText.split(/[\s,，。；;、/：:（）()]+/).filter((word) => word.length >= 2))];
  return assets
    .filter((asset) => assetTypeMatchesSlot(slot.kind, asset.type))
    .map((asset) => {
      const assetText = `${asset.title} ${asset.note} ${asset.tags.join(' ')}`.toLocaleLowerCase();
      const tagHits = asset.tags.filter((tag) => tag && slotText.includes(tag.toLocaleLowerCase())).length;
      const keywordHits = words.filter((word) => assetText.includes(word)).length;
      let score = tagHits * 3 + keywordHits;
      if (scriptId && asset.relatedScriptId === scriptId) score += 4;
      if (asset.favorite) score += 0.5;
      return { asset, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.asset.updatedAt - a.asset.updatedAt)
    .slice(0, 5)
    .map((entry) => entry.asset);
}

export function formatAssetPlatforms(platforms?: Platform[]): string {
  if (!platforms?.length) return '未记录';
  return platforms.map((platform) => PLATFORM_LABELS[platform]).join(' / ');
}

export function formatAssetExpiry(expiresAt?: number): string {
  if (expiresAt === undefined || !Number.isFinite(expiresAt)) return '未记录';
  return new Date(expiresAt).toLocaleDateString('zh-CN');
}

export function formatAssetLicense(license?: AssetLicense): string {
  return license ? ASSET_LICENSE_LABELS[license] : '未记录授权';
}

export function formatAssetSource(sourceType?: AssetSourceType): string {
  return sourceType ? ASSET_SOURCE_LABELS[sourceType] : '未记录来源';
}
