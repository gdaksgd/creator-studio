import { Router } from 'express';
import { supabase, isSupabaseConfigured, SYNC_TABLE } from '../services/supabaseClient.js';

const router = Router();

// Upload sync data (topics + scripts)
router.post('/upload', async (req, res) => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      return res.status(503).json({ error: '云端同步未配置', code: 'NOT_CONFIGURED' });
    }

    const { topics, scripts, uploadedAt, baseUploadedAt } = req.body;

    if (!Array.isArray(topics) || !Array.isArray(scripts)) {
      return res.status(400).json({ error: '数据格式错误', code: 'BAD_REQUEST' });
    }

    // ---- 乐观锁（可选）--------------------------------------------------
    // 前端 creator-app/src/services/syncService.ts 目前 **还没有** 发送 record
    // baseUploadedAt 字段，所以这个字段必须是可选的：
    //   - 不传（undefined / null / 非有限数字）-> 完全保持原有行为，直接 upsert；
    //   - 传了 -> 先读云端当前 uploaded_at，若云端更新（cloud > base）则拒绝覆盖。
    // 这样后端可以先上线防止「静默失败覆盖云端」，等前端补齐字段后自动生效，
    // 不会破坏现有前端。
    // ---------------------------------------------------------------------
    const hasBase = baseUploadedAt !== undefined && baseUploadedAt !== null && baseUploadedAt !== '';
    const base = hasBase ? Number(baseUploadedAt) : NaN;

    if (Number.isFinite(base)) {
      const { data: current, error: precheckError } = await supabase
        .from(SYNC_TABLE)
        .select('uploaded_at')
        .eq('id', 1)
        .maybeSingle();

      if (precheckError) {
        console.error('[sync] upload pre-check failed:', precheckError.message, precheckError);
        return res.status(502).json({
          error: '云端查询失败: ' + precheckError.message,
          code: 'CLOUD_ERROR',
        });
      }

      const cloudUploadedAt = current ? Number(current.uploaded_at) || 0 : 0;
      if (current && cloudUploadedAt > base) {
        return res.status(409).json({
          error: '云端有更新，请先下载',
          code: 'CONFLICT',
          cloudUploadedAt,
        });
      }
    }

    const nextUploadedAt = uploadedAt || Date.now();
    const { error } = await supabase
      .from(SYNC_TABLE)
      .upsert({
        id: 1,
        data: { topics, scripts },
        uploaded_at: nextUploadedAt,
      });

    if (error) {
      console.error('[sync] upload error:', error.message, error);
      return res.status(500).json({ error: '同步失败: ' + error.message, code: 'UPLOAD_FAILED' });
    }

    res.json({ success: true, uploadedAt: nextUploadedAt });
  } catch (err) {
    console.error('[sync] upload exception:', err);
    res.status(500).json({ error: '服务器错误', code: 'SERVER_ERROR' });
  }
});

// Download sync data.
//
// 返回语义（关键：绝不能把「查询失败」伪装成「云端为空」，否则前端会把本地
// 数据上传覆盖云端）：
//   503 + { code: 'NOT_CONFIGURED' }                          云端未配置
//   502 + { code: 'CLOUD_ERROR' }                             查询失败（已打日志）
//   200 + { topics: [], scripts: [], uploadedAt: 0, empty: true }   查询成功但表里没有行
//   200 + { topics, scripts, uploadedAt, empty: false }        查询成功且有数据
router.get('/download', async (req, res) => {
  try {
    if (!isSupabaseConfigured() || !supabase) {
      return res.status(503).json({ error: '云端同步未配置', code: 'NOT_CONFIGURED' });
    }

    // 用 maybeSingle()：0 行时返回 data=null / error=null，
    // 不会像 single() 那样把「没有行」报成 PGRST116 错误。
    const { data, error } = await supabase
      .from(SYNC_TABLE)
      .select('data, uploaded_at')
      .eq('id', 1)
      .maybeSingle();

    if (error) {
      console.error('[sync] download query failed:', error.message, error);
      return res.status(502).json({
        error: '云端查询失败: ' + error.message,
        code: 'CLOUD_ERROR',
      });
    }

    if (!data) {
      // 查询成功了，只是表里确实没有这一行。
      return res.json({ topics: [], scripts: [], uploadedAt: 0, empty: true });
    }

    const syncData = (data.data || {}) as { topics?: any[]; scripts?: any[] };
    const uploadedAt = Number(data.uploaded_at) || 0;
    res.json({
      topics: syncData.topics || [],
      scripts: syncData.scripts || [],
      uploadedAt,
      empty: uploadedAt === 0 && (syncData.topics || []).length === 0 && (syncData.scripts || []).length === 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[sync] download exception:', err);
    res.status(502).json({ error: '云端查询失败: ' + message, code: 'CLOUD_ERROR' });
  }
});

// Check if sync is configured
router.get('/status', (req, res) => {
  res.json({
    syncConfigured: isSupabaseConfigured(),
  });
});

export default router;
