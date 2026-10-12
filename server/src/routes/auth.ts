import { Router } from 'express';
import type { Response } from 'express';
import { isSupabaseConfigured } from '../services/supabaseClient.js';
import { loginUser, registerUser, toPublicUser } from '../services/authStore.js';
import { CloudError } from '../services/cloudStore.js';
import { requireAuth } from '../middleware/requireAuth.js';
import type { AuthedRequest } from '../middleware/requireAuth.js';

// ============================================
// 账号接口（云端数据按账号隔离）
//
//   POST /api/auth/register  注册并直接返回 token
//   POST /api/auth/login     登录
//   GET  /api/auth/me        当前账号 + 云端数据概览（需 Bearer）
//   POST /api/auth/logout    退出（token 无状态，服务端只是确认）
//   GET  /api/auth/status    云账号功能是否可用（公开）
// ============================================

const router = Router();

function sendError(res: Response, err: unknown, fallbackMessage: string): void {
  if (err instanceof CloudError) {
    res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
    return;
  }
  console.error('[auth] unexpected error:', err);
  res.status(500).json({ error: fallbackMessage, code: 'SERVER_ERROR' });
}

router.post('/register', async (req, res) => {
  try {
    const body = (req.body || {}) as { username?: unknown; password?: unknown };
    const result = await registerUser(body.username, body.password);
    res.status(201).json(result);
  } catch (err) {
    sendError(res, err, '注册失败，请稍后再试');
  }
});

router.post('/login', async (req, res) => {
  try {
    const body = (req.body || {}) as { username?: unknown; password?: unknown };
    const result = await loginUser(body.username, body.password);
    res.json(result);
  } catch (err) {
    sendError(res, err, '登录失败，请稍后再试');
  }
});

router.get('/me', requireAuth, (req, res) => {
  const authed = req as AuthedRequest;
  const user = authed.authUser;
  if (!user) {
    res.status(401).json({ error: '未登录或登录已过期', code: 'UNAUTHORIZED' });
    return;
  }
  const account = authed.cloudAccount;
  res.json({
    user: toPublicUser(user),
    cloud: {
      uploadedAt: account?.uploadedAt ?? 0,
      topicCount: account?.topics.length ?? 0,
      scriptCount: account?.scripts.length ?? 0,
    },
  });
});

router.post('/logout', requireAuth, (_req, res) => {
  // token 是无状态的：客户端删掉即可，这里只是给前端一个确定的成功响应
  res.json({ success: true });
});

router.get('/status', (_req, res) => {
  res.json({ authConfigured: isSupabaseConfigured() });
});

export default router;
