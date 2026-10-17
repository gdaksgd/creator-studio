import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

/** 解析正整数环境变量，非法值回退到默认值 */
function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  // 完整采集（RSS + YouTube + B站）的 cron；YouTube 一次 search.list 就要 100 单位配额，
  // 一轮最多 20 个关键词 ≈ 2000 单位，而每日配额只有 10000 单位，所以不能调得太密。
  collectInterval: process.env.COLLECT_INTERVAL || '0 */6 * * *',
  // 轻量采集（只跑 RSS + B站，不碰 YouTube 配额）的 cron，默认每小时第 5 分钟跑一次。
  lightCollectInterval: process.env.LIGHT_COLLECT_INTERVAL || '5 * * * *',
  dataDir: path.join(__dirname, '..', 'data'),
  // Cloud sync (Supabase)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  // 账号 token 的 HMAC 密钥；不配会自动生成并持久化到 server/data/auth-secret.txt
  authSecret: process.env.AUTH_SECRET || '',
  // 私密访问日报的路径令牌（/r/<token>/visits-YYYY-MM-DD.html）；为空则路由全部 404
  reportToken: process.env.REPORT_TOKEN || '',
  // AI 每日调用上限（公网防刷，默认 300）
  aiDailyLimit: parsePositiveInt(process.env.AI_DAILY_LIMIT, 300),
};

export function isAIConfigured(): boolean {
  return config.deepseekApiKey.length > 0 && !config.deepseekApiKey.includes('your_');
}

export function isYouTubeConfigured(): boolean {
  return config.youtubeApiKey.length > 0 && !config.youtubeApiKey.includes('your_');
}
