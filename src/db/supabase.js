import { createClient } from '@supabase/supabase-js';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';

if (!config.supabase.url || !config.supabase.serviceRoleKey) {
  logger.warn('⚠️ Supabase credentials missing from env! Database operations will fail.');
}

export const supabase = createClient(
  config.supabase.url || 'https://placeholder.supabase.co',
  config.supabase.serviceRoleKey || 'placeholder-key',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  }
);
