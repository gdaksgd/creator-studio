import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../services/authStore.js';
import { CloudError, readCloud } from '../services/cloudStore.js';
import type { CloudAccountData, CloudUserRecord } from '../services/cloudStore.js';

// ============================================
// Bearer token 鉴权中间件
//
// 用法：router.get('/x', requireAuth, handler)
// 通过后 req 上会挂好：
//   authUser     当前账号记录（含 id / username）
//   cloudAccount 该账号的云端数据（可能为 undefined，表示还没上传过）
// ============================================

export interface AuthedRequest extends Request {
  authUser?: CloudUserRecord;
  cloudAccount?: CloudAccountData;
}

export const UNAUTHORIZED_BODY = { error: '未登录或登录已过期', code: 'UNAUTHORIZED' } as const;

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';

  if (!token) {
    res.status(401).json(UNAUTHORIZED_BODY);
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json(UNAUTHORIZED_BODY);
    return;
  }

  try {
    const { blob } = await readCloud();
    const user = blob.users.find((candidate) => candidate.id === payload.userId);
    if (!user) {
      res.status(401).json(UNAUTHORIZED_BODY);
      return;
    }

    const authed = req as AuthedRequest;
    authed.authUser = user;
    authed.cloudAccount = blob.accounts[user.id];
    next();
  } catch (err) {
    if (err instanceof CloudError) {
      res.status(err.status).json({ error: err.message, code: err.code, ...(err.extra || {}) });
      return;
    }
    console.error('[auth] requireAuth failed:', err);
    res.status(502).json({ error: '云端查询失败', code: 'CLOUD_ERROR' });
  }
}
