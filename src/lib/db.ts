import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let client: SupabaseClient | null = null;

/**
 * Service-role client. Server-side only — it bypasses RLS, so it must never
 * be imported into a client component. All tables have RLS enabled with no
 * policies, which means the public anon key can read nothing at all.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { 'x-application-name': 'toap-spin-win' } },
    });
  }
  return client;
}
