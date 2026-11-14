import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const configOk = Boolean(url && anon);

let browserClient: SupabaseClient | null = null;

/** Client navigateur (session gardée sur l'appareil). */
export function supabaseBrowser(): SupabaseClient {
  if (!browserClient) browserClient = createClient(url, anon);
  return browserClient;
}

/** Client serveur (app à usage personnel, sans compte). */
export function supabaseServer(): SupabaseClient | null {
  if (!configOk) return null;
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}
