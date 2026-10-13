import { Router } from 'express';
import type { Response } from 'express';
import { isSupabaseConfigured } from '../services/supabaseClient.js';
import { CloudError, readCloud, updateCloud } from '../services/cloudStore.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { AuthedRequest } from '../middleware/requireAuth.js';

// ============================================
// 云端同步（按账号隔离）
//
// 一个账号一份云端数据，存在 app_sync 那一行的 data.accounts[userId] 里。
// /upload 与 /download 都需要 Bearer token（见 middleware/requireAuth.ts）：
//   - 没有 token / token 过期 -> 401 { code: 'UNAUTHORIZED' }
//   - 账号 A 读写不到账号 B 的数据（userId 来自 token，不接受请求体里传 userId）
// /status 保持公开，前端启动时用它判断云端功能是否配置。
// ============================================

const router = Router();

function sendError(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof CloudError) {
    res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
    return;
  }
  console.error('[sync] unexpected error:', err);
  res.status(500).json({ error: fallbackMessage, code: 'SERVER_ERROR' });
}

// 上传本账号的同步数据（topics + scripts）
router.post('/upload', requireAuth, async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const userId = authed.authUser?.id;
    if (!userId) {
      res.status(401).json({ error: '未登录或登录已过期', code: 'UNAUTHORIZED' });
      return;
    }

    const body = (req.body || {}) as {
      topics?: unknown;
      scripts?: unknown;
      assets?: unknown;
      materialFavorites?: unknown;
      briefAttachments?: unknown;
      marketingWorkbench?: { experiments?: unknown[]; briefs?: unknown[] };
      uploadedAt?: unknown;
      baseUploadedAt?: unknown;
    };
    const { topics, scripts, uploadedAt, baseUploadedAt } = body;
    const assets = Array.isArray(body.assets) ? body.assets : undefined;
    const materialFavorites = Array.isArray(body.materialFavorites) ? body.materialFavorites : undefined;
    const briefAttachments = Array.isArray(body.briefAttachments) ? body.briefAttachments : undefined;
    const marketingWorkbench = body.marketingWorkbench && typeof body.marketingWorkbench === 'object' && !Array.isArray(body.marketingWorkbench)
      ? {
          experiments: Array.isArray(body.marketingWorkbench.experiments) ? body.marketingWorkbench.experiments : [],
          briefs: Array.isArray(body.marketingWorkbench.briefs) ? body.marketingWorkbench.briefs : [],
        }
      : undefined;

    if (!Array.isArray(topics) || !Array.isArray(scripts)) {
      res.status(400).json({ error: '数据格式错误', code: 'BAD_REQUEST' });
      return;
    }

    // ---- 乐观锁（可选）--------------------------------------------------
    // 前端传 baseUploadedAt（它上次看到的云端 uploadedAt）时：
    //   - 本账号云端更新（cloud > base）-> 409 CONFLICT，让前端先下载再合并
    // 不传则退回「直接覆盖」的旧行为，不会破坏现有前端。
    // ---------------------------------------------------------------------
    const hasBase = baseUploadedAt !== undefined && baseUploadedAt !== null && baseUploadedAt !== '';
    const base = hasBase ? Number(baseUploadedAt) : NaN;

    const requestedUploadedAt = Number(uploadedAt);
    const nextUploadedAt =
      Number.isFinite(requestedUploadedAt) && requestedUploadedAt > 0 ? requestedUploadedAt : Date.now();

    const result = await updateCloud((blob) => {
      const cloudUploadedAt = blob.accounts[userId]?.uploadedAt ?? 0;
      if (Number.isFinite(base) && cloudUploadedAt > base) {
        throw new CloudError(409, 'CONFLICT', '云端有更新，请先下载', { cloudUploadedAt });
      }
      // Preserve other per-user payloads (AI key, platform account analytics,
      // sync history) when the content workspace syncs its topics/scripts.
      const current = blob.accounts[userId] ?? { topics: [], scripts: [], uploadedAt: 0 };
      blob.accounts[userId] = { ...current, topics, scripts, ...(assets ? { assets } : {}), ...(materialFavorites ? { materialFavorites } : {}), ...(briefAttachments ? { briefAttachments } : {}), ...(marketingWorkbench ? { marketingWorkbench } : {}), uploadedAt: nextUploadedAt };
      return { uploadedAt: nextUploadedAt };
    });

    res.json({ success: true, uploadedAt: result.uploadedAt });
  } catch (err) {
    sendError(res, err, '同步失败');
  }
});

// 下载本账号的同步数据。
//
// 返回语义（关键：绝不能把「查询失败」伪装成「云端为空」，否则前端会把本地数据
// 上传覆盖云端）：
//   401 + { code: 'UNAUTHORIZED' }                            未登录 / token 过期
//   503 + { code: 'NOT_CONFIGURED' }                          云端未配置
//   502 + { code: 'CLOUD_ERROR' }                             查询失败（已打日志）
//   200 + { topics: [], scripts: [], uploadedAt: 0, empty: true }   该账号还没有云端数据
//   200 + { topics, scripts, uploadedAt, empty: false }       有数据
router.get('/download', requireAuth, async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const userId = authed.authUser?.id;
    if (!userId) {
      res.status(401).json({ error: '未登录或登录已过期', code: 'UNAUTHORIZED' });
      return;
    }

    const { blob } = await readCloud();
    const account = blob.accounts[userId];
    // 「云端为空」只看内容字段本身。uploadedAt 只是内容版本号，不能单独当作「有内容」的
    // 证据：账号统计/同步历史的写入曾经 bump 过它，于是「从未上传内容的账号」会返回
    // uploadedAt>0 + 空数组，前端 syncDownload() 判定云端更新 -> clear() 掉本地唯一副本。
    const hasContent = !!account && (
      account.topics.length > 0 ||
      account.scripts.length > 0 ||
      !!account.assets?.length ||
      !!account.materialFavorites?.length ||
      !!account.briefAttachments?.length ||
      !!account.marketingWorkbench
    );
    const empty = !hasContent;

    if (empty) {
      res.json({ topics: [], scripts: [], assets: [], materialFavorites: [], briefAttachments: [], marketingWorkbench: undefined, uploadedAt: 0, empty: true });
      return;
    }

    res.json({
      topics: account.topics,
      scripts: account.scripts,
      assets: account.assets ?? [],
      materialFavorites: account.materialFavorites ?? [],
      briefAttachments: account.briefAttachments ?? [],
      marketingWorkbench: account.marketingWorkbench,
      uploadedAt: account.uploadedAt,
      empty: false,
    });
  } catch (err) {
    sendError(res, err, '云端查询失败');
  }
});

// 云端功能是否配置（公开，不需要登录）
router.get('/status', (_req, res) => {
  res.json({
    syncConfigured: isSupabaseConfigured(),
    accountMode: true,
  });
});

export default router;
