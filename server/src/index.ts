import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { config } from './config.js';
import { startScheduler } from './services/scheduler.js';
import { rateLimit, dailyQuota } from './middleware/rateLimit.js';
import newsRoutes from './routes/news.js';
import aiRoutes from './routes/ai.js';
import syncRoutes from './routes/sync.js';
import videoRoutes from './routes/video.js';
import benchmarkRoutes from './routes/benchmark.js';
import reportRoutes from './routes/report.js';
import { refreshAll as refreshBenchmarks } from './services/benchmarkService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();

// 前面是 Cloudflare Tunnel，必须信任一层代理，req.ip 才能拿到真实客户端 IP
app.set('trust proxy', 1);

// 只允许本地开发端口 + 同源请求；无 Origin 头的请求（curl 等）放行
const DEV_ORIGINS = new Set(['http://localhost:5173', 'http://127.0.0.1:5173']);

function isSameOrigin(origin: string, host: string | undefined): boolean {
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

app.use(
  cors((req, callback) => {
    const origin = req.headers.origin;
    const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host;
    const allowed = !origin || DEV_ORIGINS.has(origin) || isSameOrigin(origin, host);
    callback(null, { origin: allowed });
  })
);

app.use(express.json({ limit: '2mb' }));

// Health check (public, no rate limit)
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ---------- 分层限流 ----------
// 按 IP 计数。严格档位保护花钱/耗时的接口，宽松档位兜住其它 /api 请求。
const aiRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 20 }); // /api/ai/*：每分钟 20 次
const collectRateLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 3 }); // /api/news/collect：每 10 分钟 3 次
const looseRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 120 }); // 其它 /api/*：每分钟 120 次
const videoRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 }); // /api/video/*：每分钟 30 次（会外呼 B站）
const benchmarkRateLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 }); // /api/benchmark：读缓存，很轻
const benchmarkRefreshLimiter = rateLimit({ windowMs: 10 * 60 * 1000, max: 3 }); // 强制重采：每次会外呼 B站 18 次
const aiDailyQuota = dailyQuota({ limit: config.aiDailyLimit }); // AI 每日总配额，默认 300

app.use('/api/ai', aiRateLimiter, (req, res, next) => {
  // 只读接口与纯本地保存不消耗 AI 配额，只有可能真正调用 AI 的请求才计数
  const apiPath = req.originalUrl.split('?')[0];
  if (req.method === 'GET' || apiPath === '/api/ai/account') {
    next();
    return;
  }
  aiDailyQuota(req, res, next);
});

app.use('/api/news/collect', collectRateLimiter);

app.use('/api/video', videoRateLimiter);

// 强制重采要单独限流（比读接口严格得多），必须注册在 /api/benchmark 之前
app.use('/api/benchmark/refresh', benchmarkRefreshLimiter);
app.use('/api/benchmark', benchmarkRateLimiter);

app.use('/api', (req, res, next) => {
  // 上面已经严格限流的路径不再重复计数
  const apiPath = req.originalUrl.split('?')[0];
  if (
    apiPath.startsWith('/api/ai') ||
    apiPath === '/api/news/collect' ||
    apiPath.startsWith('/api/video') ||
    apiPath.startsWith('/api/benchmark')
  ) {
    next();
    return;
  }
  looseRateLimiter(req, res, next);
});

// Routes
app.use('/api/news', newsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/benchmark', benchmarkRoutes);
app.use('/api/report', reportRoutes);

// 未匹配的 /api/* 一律返回 404 JSON（不能落到 SPA fallback 返回 HTML）
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve frontend static files (production mode)
const frontendDist = path.join(__dirname, '..', 'public');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // SPA fallback: all non-API GET routes serve index.html
  // 用 app.use 而不是 app.get('*')，这样 Express 5 下也不会抛 path-to-regexp 错误
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`\n=================================`);
  console.log(`  Creator Studio Server`);
  console.log(`  Running on http://localhost:${config.port}`);
  console.log(`=================================\n`);
  console.log(`AI: ${config.deepseekApiKey ? 'Configured' : 'Not configured (set DEEPSEEK_API_KEY in .env)'}`);
  console.log(`AI daily limit: ${config.aiDailyLimit}`);
  console.log(`YouTube: ${config.youtubeApiKey ? 'Configured' : 'Not configured (set YOUTUBE_API_KEY in .env)'}`);
  console.log(`Supabase: ${config.supabaseUrl ? 'Configured' : 'Not configured (set SUPABASE_URL in .env)'}`);
  console.log(`Frontend: ${fs.existsSync(frontendDist) ? 'Serving from /public' : 'Not built (run frontend build first)'}`);
  console.log('');

  // Start scheduled collection
  startScheduler();

  // 预热基准线缓存：首次部署需要约 30 秒（10 页热门榜 + 8 个品类搜索），
  // 放在后台跑，不阻塞启动；失败只影响基准线，其它功能照常。
  void refreshBenchmarks();

  // Initial collection on startup (delayed)
  setTimeout(() => {
    import('./services/scheduler.js').then(({ collectAll }) => {
      collectAll().catch(console.error);
    });
  }, 3000);
});
