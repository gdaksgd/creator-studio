import type { Request, Response, NextFunction } from 'express';

// ============================================
// 内存限流 / 配额中间件（零依赖，纯 Map 实现）
// 用途：公网无密码访问后的防刷保护（保护 DeepSeek API Key）
// ============================================

/** 单个客户端的计数条目（固定窗口） */
interface CounterEntry {
  count: number;
  /** 当前窗口的过期时间戳 */
  resetAt: number;
}

export interface RateLimitOptions {
  /** 窗口长度（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大请求数 */
  max: number;
  /** 超限时的错误文案 */
  message?: string;
}

export interface DailyQuotaOptions {
  /** 每天允许的最大次数 */
  limit: number;
  /** 超限时的错误文案 */
  message?: string;
}

const DEFAULT_RATE_LIMIT_MESSAGE = '请求过于频繁，请稍后再试';
const DEFAULT_QUOTA_MESSAGE = '今日 AI 配额已用完，请明天再试';

/** 所有限流实例共享一个清理定时器，避免每个实例各起一个定时器 */
const stores = new Set<Map<string, CounterEntry>>();
const SWEEP_INTERVAL_MS = 60 * 1000;
let sweepTimer: NodeJS.Timeout | null = null;

/** 定期清理所有已过期的 key，避免内存泄漏 */
function ensureSweeper(): void {
  if (sweepTimer) return;

  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const store of stores) {
      for (const [key, entry] of store) {
        if (entry.resetAt <= now) {
          store.delete(key);
        }
      }
    }
  }, SWEEP_INTERVAL_MS);

  // 不要因为这个定时器阻止进程退出
  sweepTimer.unref();
}

/**
 * 取客户端标识。
 * 前面有 Cloudflare Tunnel，必须在 index.ts 里 app.set('trust proxy', 1)，
 * 否则 req.ip 只会是隧道本机的 127.0.0.1，所有用户会共用一个计数桶。
 */
export function clientKey(req: Request): string {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  // ::ffff:1.2.3.4 -> 1.2.3.4，并去掉 IPv6 的 %zone 后缀
  return ip.replace(/^::ffff:/, '').split('%')[0];
}

/** 固定窗口限流：同一 IP 在 windowMs 内最多 max 次 */
export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, message = DEFAULT_RATE_LIMIT_MESSAGE } = options;

  const store = new Map<string, CounterEntry>();
  stores.add(store);
  ensureSweeper();

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    // CORS 预检请求不计数
    if (req.method === 'OPTIONS') {
      next();
      return;
    }

    const now = Date.now();
    const key = clientKey(req);
    const entry = store.get(key);

    // 新窗口（首次访问或窗口已过期）
    if (!entry || entry.resetAt <= now) {
      store.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - 1)));
      next();
      return;
    }

    entry.count += 1;

    if (entry.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({ error: message });
      return;
    }

    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    next();
  };
}

/** 本地时区的日期 key（每天 0 点重置） */
function localDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 每日总配额：跨天自动重置，超限返回 429 */
export function dailyQuota(options: DailyQuotaOptions) {
  const { limit, message = DEFAULT_QUOTA_MESSAGE } = options;

  let dayKey = localDayKey(new Date());
  let used = 0;

  return function dailyQuotaMiddleware(req: Request, res: Response, next: NextFunction): void {
    const today = localDayKey(new Date());
    if (today !== dayKey) {
      dayKey = today;
      used = 0;
    }

    if (used >= limit) {
      res.setHeader('X-Daily-Quota-Limit', String(limit));
      res.setHeader('X-Daily-Quota-Remaining', '0');
      res.status(429).json({ error: message });
      return;
    }

    used += 1;
    res.setHeader('X-Daily-Quota-Limit', String(limit));
    res.setHeader('X-Daily-Quota-Remaining', String(Math.max(0, limit - used)));
    next();
  };
}
