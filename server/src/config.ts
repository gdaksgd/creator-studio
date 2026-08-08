import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001'),
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  collectInterval: process.env.COLLECT_INTERVAL || '0 */6 * * *',
  dataDir: path.join(__dirname, '..', 'data'),
  // Cloud sync (Supabase)
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  // Access password
  authPassword: process.env.AUTH_PASSWORD || '',
};

export function isAIConfigured(): boolean {
  return config.deepseekApiKey.length > 0 && !config.deepseekApiKey.includes('your_');
}

export function isYouTubeConfigured(): boolean {
  return config.youtubeApiKey.length > 0 && !config.youtubeApiKey.includes('your_');
}
