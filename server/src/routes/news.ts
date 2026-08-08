import { Router } from 'express';
import { db } from '../db.js';
import { collectAll } from '../services/scheduler.js';

const router = Router();

// 获取资讯列表
router.get('/', (req, res) => {
  const category = req.query.category as string | undefined;
  const sourceType = req.query.sourceType as string | undefined;
  const limit = parseInt(req.query.limit as string) || 50;

  let news = db.getNews();

  if (category && category !== 'all') {
    news = news.filter((n) => n.category === category);
  }
  if (sourceType && sourceType !== 'all') {
    news = news.filter((n) => n.sourceType === sourceType);
  }

  res.json({
    news: news.slice(0, limit),
    total: news.length,
    lastCollected: db.getLastCollected(),
  });
});

// 手动触发收集
router.post('/collect', async (req, res) => {
  try {
    const result = await collectAll();
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 标记为已用选题
router.post('/:id/mark-topic', (req, res) => {
  db.markAsTopic(req.params.id);
  res.json({ success: true });
});

// 清空资讯
router.delete('/', (req, res) => {
  db.clearNews();
  res.json({ success: true });
});

export default router;
