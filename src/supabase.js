import { createClient } from '@supabase/supabase-js';

const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};
const supabaseUrl = env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || '';

export const remoteSupabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      })
    : null;

export const supabase = null;

export function isSupabaseConfigured() {
  return false;
}

export function getSupabaseStatus() {
  return {
    configured: false,
    url: supabaseUrl || null,
    hasAnonKey: Boolean(supabaseAnonKey),
  };
}
