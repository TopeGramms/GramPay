import { createClient } from '@supabase/supabase-js';
import { config } from './config.js';

export const supabase = createClient(
  config.supabase.url,
  process.env.SUPABASE_SERVICE_ROLE_KEY || config.supabase.anonKey
);
