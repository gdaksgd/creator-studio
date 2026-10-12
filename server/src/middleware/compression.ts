import zlib from 'node:zlib';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, NextFunction } from 'express';

// ============================================
// 传输层优化（零依赖，只用 node:zlib）
//
//   gzipJson()             /api/* 的 JSON / 文本响应即时 gzip
//   ensurePrecompressed()  启动时为静态产物生成 .gz 预压缩副本
//   servePrecompressed()   命中 .gz 时直接下发（带 Content-Encoding: gzip）
//
// 公网走 Cloudflare 时它自己也会压缩，但预压缩仍然有用：
//   - 本机 / 局域网直连（192.168.x.x:3001）明显更快
//   - Cloudflare 对已经带 Content-Encoding: gzip 的响应直接透传
// ============================================

const MIN_GZIP_SIZE = 1024;

/** 可预压缩的静态后缀 -> MIME */
const PRECOMPRESS_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.map': 'application/json; charset=utf-8',
};

function acceptsGzip(req: Request): boolean {
  return /\bgzip\b/i.test(String(req.headers['accept-encoding'] || ''));
}

/** /api/* 的 JSON 响应走 gzip（响应体 ≥ 1KB 且压缩后确实更小才替换） */
export function gzipJson() {
  return function gzipJsonMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!acceptsGzip(req)) {
      next();
      return;
    }

    const originalSend = res.send.bind(res) as (body?: unknown) => Response;

    res.send = ((body?: unknown) => {
      try {
        const contentType = String(res.getHeader('content-type') || '');
        const compressible = /^(application\/(json|javascript)|text\/)/i.test(contentType);
        if (compressible && !res.getHeader('content-encoding')) {
          const raw =
            typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.isBuffer(body) ? body : null;
          if (raw && raw.length >= MIN_GZIP_SIZE) {
            const compressed = zlib.gzipSync(raw, { level: 6 });
            if (compressed.length < raw.length) {
              res.setHeader('Content-Encoding', 'gzip');
              res.setHeader('Vary', 'Accept-Encoding');
              // express 会按实际 body 重算 Content-Length
              return originalSend(compressed);
            }
          }
        }
      } catch (err) {
        console.warn('[gzip] 压缩失败，按原样返回:', err);
      }
      return originalSend(body);
    }) as Response['send'];

    next();
  };
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

/** 为静态产物生成 .gz 副本（已存在且比源文件新就跳过） */
export async function ensurePrecompressed(dir: string): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  if (!fs.existsSync(dir)) return { created, skipped };

  for (const file of await listFiles(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (!PRECOMPRESS_TYPES[ext]) continue;

    const stat = await fsp.stat(file);
    if (stat.size < MIN_GZIP_SIZE) continue;

    const gzPath = `${file}.gz`;
    try {
      const gzStat = await fsp.stat(gzPath);
      if (gzStat.mtimeMs >= stat.mtimeMs) {
        skipped += 1;
        continue;
      }
    } catch {
      // 还没有 .gz，下面生成
    }

    const raw = await fsp.readFile(file);
    await fsp.writeFile(gzPath, zlib.gzipSync(raw, { level: 9 }));
    created += 1;
  }
  return { created, skipped };
}

/**
 * 命中预压缩副本就直接下发。
 * 必须挂在 express.static 之前；只能服务 rootDir 内部、后缀在白名单里的文件。
 */
export function servePrecompressed(rootDir: string) {
  const root = path.resolve(rootDir);

  return function servePrecompressedMiddleware(req: Request, res: Response, next: NextFunction): void {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !acceptsGzip(req) || req.headers.range) {
      next();
      return;
    }

    let urlPath = req.path || '';
    try {
      urlPath = decodeURIComponent(urlPath);
    } catch {
      next();
      return;
    }
    if (!urlPath || urlPath.includes('..')) {
      next();
      return;
    }

    const ext = path.extname(urlPath).toLowerCase();
    const mime = PRECOMPRESS_TYPES[ext];
    if (!mime) {
      next();
      return;
    }

    const target = path.resolve(path.join(root, urlPath));
    if (target !== root && !target.startsWith(root + path.sep)) {
      next();
      return;
    }

    const gzPath = `${target}.gz`;
    fs.stat(gzPath, (err, stat) => {
      if (err || !stat.isFile()) {
        next();
        return;
      }

      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader(
        'Cache-Control',
        urlPath.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
      );

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      const stream = fs.createReadStream(gzPath);
      stream.on('error', (streamErr) => {
        console.warn('[static] 读取预压缩文件失败:', streamErr);
        if (!res.headersSent) {
          res.removeHeader('Content-Encoding');
          res.removeHeader('Content-Length');
          next();
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    });
  };
}
