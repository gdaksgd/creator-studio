import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export const isSupabaseConfigured = (): boolean => {
  return config.supabaseUrl.length > 0 && config.supabaseAnonKey.length > 0;
};

export const supabase = isSupabaseConfigured()
  ? createClient(config.supabaseUrl, config.supabaseAnonKey)
  : null;

// Table name for app sync data
export const SYNC_TABLE = 'app_sync';
