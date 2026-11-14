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

/** Client serveur agissant au nom de l'utilisateur (RLS appliqué). */
export async function supabaseFromRequest(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token || !configOk) return null;
  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
}
