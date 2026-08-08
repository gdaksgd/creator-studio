import crypto from 'crypto';
import { db } from '../db.js';
import type { AccountInfo, SyncResult, SyncHistoryEntry } from '../types.js';

// ─── WBI Signing (shared with bilibiliCollector) ──────────

const MIXIN_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 52, 44, 34,
];

const BILI_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Referer': 'https://www.bilibili.com',
  'Accept-Language': 'zh-CN,zh;q=0.9',
};

interface WbiCache {
  mixinKey: string;
  expires: number;
}

let wbiCache: WbiCache | null = null;

async function getMixinKey(): Promise<string> {
  if (wbiCache && wbiCache.expires > Date.now()) {
    return wbiCache.mixinKey;
  }

  const resp = await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: BILI_HEADERS,
  });
  const data = (await resp.json()) as any;
  const wbiImg = data?.data?.wbi_img;
  if (!wbiImg?.img_url || !wbiImg?.sub_url) {
    throw new Error('Failed to get wbi keys');
  }

  const imgKey = (wbiImg.img_url as string).split('/').pop()?.split('.')[0] || '';
  const subKey = (wbiImg.sub_url as string).split('/').pop()?.split('.')[0] || '';
  const raw = imgKey + subKey;
  const mixinKey = MIXIN_ENC_TAB.map((n) => raw[n]).join('').slice(0, 32);

  wbiCache = { mixinKey, expires: Date.now() + 3600000 };
  return mixinKey;
}

function signWbi(params: Record<string, string | number>, mixinKey: string) {
  const wts = Math.floor(Date.now() / 1000);
  const allParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    allParams[k] = String(v);
  }
  allParams.wts = String(wts);

  const sorted = Object.entries(allParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');

  const wRid = crypto.createHash('md5').update(sorted + mixinKey).digest('hex');
  return { w_rid: wRid, wts };
}

// ─── B站 Account Sync ─────────────────────────────────────

interface BiliAccountData {
  name: string;
  followers: number;
  totalVideos: number;
  totalLikes: number;
  avgViews: number;
  sign: string;
  level: number;
}

/**
 * 获取B站账号数据
 * 使用 card API (无需登录) + arc/search API (需WBI签名)
 */
async function syncBilibili(uid: string): Promise<{ data: BiliAccountData | null; error?: string }> {
  const syncedFields: string[] = [];
  const errors: string[] = [];

  // 1. Card API — 账号基础信息（粉丝数、名字、签名、等级）
  let cardData: any = null;
  try {
    const resp = await fetch(
      `https://api.bilibili.com/x/web-interface/card?mid=${uid}`,
      { headers: BILI_HEADERS },
    );
    const result = (await resp.json()) as any;
    if (result.code === 0 && result.data) {
      cardData = result.data;
      syncedFields.push('B站粉丝数', 'B站账号名', 'B站总点赞', '已发布视频数');
    } else {
      errors.push(`B站Card API: ${result.message || '未知错误'}`);
    }
  } catch (err) {
    errors.push(`B站Card API: ${(err as Error).message}`);
  }

  // 2. Video list API — 视频列表（计算平均播放量）
  let avgViews = 0;
  try {
    const mixinKey = await getMixinKey();
    const params: Record<string, string | number> = {
      mid: uid,
      pn: 1,
      ps: 30,
      order: 'pubdate',
    };
    const { w_rid, wts } = signWbi(params, mixinKey);

    const url = new URL('https://api.bilibili.com/x/space/wbi/arc/search');
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v));
    }
    url.searchParams.set('w_rid', w_rid);
    url.searchParams.set('wts', String(wts));

    const resp = await fetch(url.toString(), {
      headers: {
        ...BILI_HEADERS,
        'Referer': `https://space.bilibili.com/${uid}/video`,
      },
    });
    const result = (await resp.json()) as any;

    if (result.code === 0 && result.data?.list?.vlist) {
      const vlist = result.data.list.vlist;
      if (vlist.length > 0) {
        const totalViews = vlist.reduce((sum: number, v: any) => sum + (v.play || 0), 0);
        avgViews = Math.round(totalViews / vlist.length);
        syncedFields.push('B站平均播放量');
      }
    } else {
      // Video API may be rate-limited or require cookie — non-fatal
      errors.push(`B站视频列表: ${result.message || '风控限制'}`);
    }
  } catch (err) {
    errors.push(`B站视频列表: ${(err as Error).message}`);
  }

  if (!cardData) {
    return { data: null, error: errors.join('; ') };
  }

  const card = cardData.card || {};
  return {
    data: {
      name: card.name || '',
      followers: cardData.follower || card.fans || 0,
      totalVideos: cardData.archive_count || 0,
      totalLikes: cardData.like_num || 0,
      avgViews,
      sign: card.sign || '',
      level: card.level_info?.current_level || 0,
    },
    error: errors.length > 0 ? errors.join('; ') : undefined,
  };
}

// ─── 抖音 Account Sync ────────────────────────────────────

/**
 * 抖音自动获取 — 当前抖音Web端有严格的反爬机制（msToken/a_bogus），
 * 无法通过简单API请求获取用户数据。
 * 返回 null 表示无法自动获取，用户需手动填写。
 */
async function syncDouyin(douyinId: string): Promise<{ data: { name: string; followers: number; totalVideos: number; avgViews: number } | null; error?: string }> {
  // 抖音Web API需要复杂的签名机制，目前无法绕过
  // 未来如果抖音开放API或找到可行方案，可在此处实现
  return {
    data: null,
    error: '抖音目前不支持自动获取（反爬限制），请手动填写',
  };
}

// ─── Main Sync Function ───────────────────────────────────

export async function syncAccount(): Promise<SyncResult> {
  const account = db.getAccountInfo();
  const syncedFields: string[] = [];
  const failedFields: string[] = [];
  const messages: string[] = [];

  // B站同步
  if (account.bilibiliUid && account.bilibiliUid.trim()) {
    console.log(`[AccountSync] Syncing B站 UID: ${account.bilibiliUid}`);
    const biliResult = await syncBilibili(account.bilibiliUid.trim());

    if (biliResult.data) {
      const updates: Partial<AccountInfo> = {
        bilibiliFollowers: biliResult.data.followers,
        bilibiliName: biliResult.data.name,
        bilibiliTotalLikes: biliResult.data.totalLikes,
        totalVideos: biliResult.data.totalVideos,
      };

      // Only update avgViews if we got it
      if (biliResult.data.avgViews > 0) {
        updates.bilibiliAvgViews = biliResult.data.avgViews;
        syncedFields.push('B站平均播放量');
      }

      syncedFields.push('B站粉丝数', 'B站账号名', 'B站总点赞', '已发布视频数');
      db.updateAccountInfo(updates);

      messages.push(`B站: ${biliResult.data.name} | 粉丝 ${biliResult.data.followers} | 视频 ${biliResult.data.totalVideos} | 赞 ${biliResult.data.totalLikes}${biliResult.data.avgViews > 0 ? ` | 均播 ${biliResult.data.avgViews}` : ''}`);

      if (biliResult.error) {
        failedFields.push(biliResult.error);
      }
    } else {
      failedFields.push(`B站: ${biliResult.error || '同步失败'}`);
      messages.push(`B站同步失败: ${biliResult.error}`);
    }
  } else {
    messages.push('B站: 未配置UID，跳过');
  }

  // 抖音同步
  if (account.douyinId && account.douyinId.trim()) {
    console.log(`[AccountSync] Syncing 抖音 ID: ${account.douyinId}`);
    const dyResult = await syncDouyin(account.douyinId.trim());

    if (dyResult.data) {
      db.updateAccountInfo({
        douyinFollowers: dyResult.data.followers,
        douyinName: dyResult.data.name,
      });
      syncedFields.push('抖音粉丝数', '抖音账号名');
      messages.push(`抖音: ${dyResult.data.name} | 粉丝 ${dyResult.data.followers}`);
    } else {
      failedFields.push(`抖音: ${dyResult.error || '同步失败'}`);
      messages.push(`抖音: ${dyResult.error}`);
    }
  } else {
    messages.push('抖音: 未配置ID，跳过');
  }

  // 更新同步时间
  const now = Date.now();
  const finalAccount = db.getAccountInfo();
  db.updateAccountInfo({
    lastSyncAt: now,
    syncMessage: messages.join(' | '),
  });

  // Save history snapshot
  const historyEntry: SyncHistoryEntry = {
    timestamp: now,
    bilibiliFollowers: finalAccount.bilibiliFollowers,
    bilibiliAvgViews: finalAccount.bilibiliAvgViews,
    bilibiliTotalLikes: finalAccount.bilibiliTotalLikes || 0,
    bilibiliVideos: finalAccount.totalVideos,
    douyinFollowers: finalAccount.douyinFollowers,
    douyinAvgViews: finalAccount.douyinAvgViews,
    douyinTotalLikes: finalAccount.douyinTotalLikes || 0,
    douyinVideos: finalAccount.douyinTotalVideos || 0,
  };
  db.addSyncHistory(historyEntry);

  const success = syncedFields.length > 0;
  console.log(`[AccountSync] Done. Synced: ${syncedFields.length} fields, Failed: ${failedFields.length}`);

  return {
    success,
    message: messages.join(' | '),
    syncedFields,
    failedFields,
    accountInfo: db.getAccountInfo(),
  };
}
