import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

let admin: SupabaseClient | undefined;

/** Service-role client. Bypasses RLS, so use it only in /api and after the allowlist check. */
export function adminDb(): SupabaseClient {
  admin ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
