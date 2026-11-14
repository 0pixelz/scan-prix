// Fonction Edge : renvoie une adresse temporaire pour afficher la photo d'une carte de prix.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jeton",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: acces } = await sb.rpc("verifier_jeton", { jeton: req.headers.get("x-jeton") ?? "" });
    if (!acces) return json({ error: "Accès refusé. Entre ton code à nouveau.", acces: false });
    const { path } = await req.json().catch(() => ({}));
    if (typeof path !== "string" || !/^cartes\/[\w-]+\.jpg$/.test(path)) return json({ error: "Photo introuvable." });
    const { data, error } = await sb.storage.from("photos").createSignedUrl(path, 600);
    if (error) return json({ error: error.message });
    return json({ url: data.signedUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
