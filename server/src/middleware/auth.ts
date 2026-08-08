import type { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

// Paths that don't require authentication
const PUBLIC_PATHS = ['/api/health', '/api/auth/check'];

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Allow public paths
  if (PUBLIC_PATHS.some((p) => req.path === p)) {
    return next();
  }

  // If no password is configured, allow all (local dev mode)
  if (!config.authPassword) {
    return next();
  }

  const password = req.headers['x-auth-password'] as string;

  if (password !== config.authPassword) {
    res.status(401).json({ error: '密码错误，请重新输入' });
    return;
  }

  next();
}
