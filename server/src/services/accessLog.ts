import fs from 'fs';
import path from 'path';
import type { Request } from 'express';
import { config } from '../config.js';

/**
 * 访问统计：每个页面访问写一行 JSON（时间 / IP / Cloudflare 地区头 / 路径 / UA）。
 *
 * - 只记录页面请求（GET/HEAD、非 /api、无静态扩展名），一次页面加载一条；
 * - 地区字段来自 Cloudflare 免费注入的请求头：CF-IPCountry 必发，
 *   CF-IPCity / CF-Region 可用时一并记录（直接访问 IP 时这些头不存在，记 null）；
 * - 文件按月切分：data/access/YYYY-MM.jsonl；只落盘，不通过任何接口对外提供。
 */

const accessDir = path.join(config.dataDir, 'access');

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  return typeof value === 'string' && value ? value : null;
}

/** 只统计页面访问：API 调用与静态资源不进访问日志 */
export function isPageRequest(method: string, pathname: string): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (pathname.startsWith('/api/')) return false;
  if (/\.[a-z0-9]{1,10}$/i.test(pathname)) return false;
  return true;
}

export function recordVisit(req: Request, statusCode: number): void {
  // ★ 不要用 req.path：挂载子路由（app.use('/api/xxx', ...)）的请求在响应结束时
  //   req.url 可能已被剥掉挂载前缀，导致 /api/* 被误记。originalUrl 不受挂载影响。
  const fullPath = (req.originalUrl || req.url || '/').split('?')[0];
  if (!isPageRequest(req.method, fullPath)) return;
  try {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const record = {
      ts: now.toISOString(),
      ip: header(req, 'cf-connecting-ip') || req.ip || null,
      country: header(req, 'cf-ipcountry'),
      region: header(req, 'cf-region'),
      city: header(req, 'cf-ipcity'),
      path: (req.originalUrl || '/').slice(0, 200),
      status: statusCode,
      ua: header(req, 'user-agent')?.slice(0, 160) ?? null,
      referer: header(req, 'referer')?.slice(0, 160) ?? null,
    };
    fs.mkdirSync(accessDir, { recursive: true });
    fs.appendFileSync(path.join(accessDir, `${month}.jsonl`), JSON.stringify(record) + '\n');
  } catch {
    /* 统计失败绝不影响请求本身 */
  }
}
