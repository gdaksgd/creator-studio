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
  collectInterval: process.env.COLLECT_INTERVAL || '0 */6 * * *',
  dataDir: path.join(__dirname, '..', 'data'),
  // Cloud sync (Supabase)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  // AI 每日调用上限（公网防刷，默认 300）
  aiDailyLimit: parsePositiveInt(process.env.AI_DAILY_LIMIT, 300),
};

export function isAIConfigured(): boolean {
  return config.deepseekApiKey.length > 0 && !config.deepseekApiKey.includes('your_');
}

export function isYouTubeConfigured(): boolean {
  return config.youtubeApiKey.length > 0 && !config.youtubeApiKey.includes('your_');
}
