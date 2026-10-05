import { Router } from 'express';
import { ensureReady, getSnapshot, refreshAll } from '../services/benchmarkService.js';

const router = Router();

// 只读快照：立即返回，缓存过期时在后台触发重采。
// 冷启动（无缓存）时 ready=false，前端应显示「正在采集基准数据」并轮询本接口。
router.get('/', (_req, res) => {
  res.json(getSnapshot());
});

// 等到确实有可用缓存再返回。首次冷启动最长约 30 秒（10 页热门榜 + 8 个品类搜索）。
router.get('/ready', async (_req, res) => {
  try {
    await ensureReady();
    const snap = getSnapshot();
    if (!snap.ready) {
      return res.status(503).json({
        error: snap.error || '基准数据暂不可用',
        ...snap,
      });
    }
    res.json(snap);
  } catch (err: any) {
    console.error('[benchmark] ready 失败:', err);
    res.status(502).json({ error: err?.message || '采集失败' });
  }
});

// 强制全量重采（并发调用复用同一个进行中的任务）
router.post('/refresh', async (_req, res) => {
  try {
    res.json(await refreshAll());
  } catch (err: any) {
    console.error('[benchmark] refresh 失败:', err);
    res.status(502).json({ error: err?.message || '采集失败' });
  }
});

export default router;
