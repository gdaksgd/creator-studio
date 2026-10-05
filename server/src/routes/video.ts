import { Router } from 'express';
import { fetchVideoStat, fetchVideoStats } from '../services/videoStatService.js';

const router = Router();

// 单条视频真实数据
//   GET /api/video/stat?url=<B站链接 | BV号 | av号>
//
// 返回语义（重要）：输入错了或 B站没这条视频，都返回 **200** + { ok: false, code }，
// 因为这些是「业务结果」而不是服务器故障——前端需要拿到结构化错误码给用户提示。
// 只有真正没预料到的异常才走 500。
router.get('/stat', async (req, res) => {
  const input = String(req.query.url || req.query.bvid || '').trim();
  if (!input) {
    return res.status(400).json({ ok: false, error: '缺少 url 参数', code: 'BAD_INPUT' });
  }

  try {
    const result = await fetchVideoStat(input);
    res.json(result);
  } catch (err) {
    console.error('[video] stat exception:', err);
    res.status(500).json({ ok: false, error: '服务器错误', code: 'SERVER_ERROR' });
  }
});

// 批量拉取（最多 20 条，串行 + 间隔）
//   POST /api/video/stats  { urls: ["...", "..."] }
router.post('/stats', async (req, res) => {
  const urls = req.body?.urls;
  if (!Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: '请提供非空的 urls 数组', code: 'BAD_REQUEST' });
  }

  try {
    const results = await fetchVideoStats(urls);
    res.json({
      results,
      total: results.length,
      okCount: results.filter((r) => r.ok).length,
    });
  } catch (err) {
    console.error('[video] stats exception:', err);
    res.status(500).json({ error: '服务器错误', code: 'SERVER_ERROR' });
  }
});

export default router;
