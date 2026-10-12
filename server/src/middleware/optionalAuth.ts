import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../services/authStore.js';
import { readCloud } from '../services/cloudStore.js';
import type { AuthedRequest } from './requireAuth.js';

// ============================================
// 「可选登录」中间件
//
// 与 requireAuth 的区别：没有 token / token 失效 / 云端读不到，都**不报错**，
// 按匿名请求继续往下走。用于 AI 路由这类「登录了就用账号自己的 Key，
// 没登录也能用站点公共 Key」的接口。
// ============================================

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  const token = header && header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
  if (!token) {
    next();
    return;
  }

  const payload = verifyToken(token);
  if (!payload) {
    next();
    return;
  }

  try {
    const { blob } = await readCloud();
    const user = blob.users.find((candidate) => candidate.id === payload.userId);
    if (user) {
      const authed = req as AuthedRequest;
      authed.authUser = user;
      authed.cloudAccount = blob.accounts[user.id];
    }
  } catch (err) {
    // 云端不可用时按匿名处理：AI 走站点公共 Key，接口本身不因此失败
    console.warn('[auth] optionalAuth skipped:', err instanceof Error ? err.message : err);
  }

  next();
}
