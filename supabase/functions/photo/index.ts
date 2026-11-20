// Fonction Edge : photos des cartes de prix.
// - { path } ou { path, grande: true } : renvoie une adresse temporaire pour afficher la photo
//   (la version en haute résolution si elle existe et que « grande » est demandé).
// - { path, originale } : enregistre la version en haute résolution d'une photo déjà lue.
//   Avec « signee: true », cette version (qui porte la signature) remplace aussi la photo de base :
//   la photo gardée est alors signée partout où elle est affichée.
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
    const { path, grande, originale, signee } = await req.json().catch(() => ({}));
    const nom = typeof path === "string" ? path.match(/^cartes\/([\w-]+\.jpg)$/)?.[1] : null;
    if (!nom) return json({ error: "Photo introuvable." });
    const seau = sb.storage.from("photos");

    if (typeof originale === "string") {
      const base64 = originale.replace(/^data:image\/\w+;base64,/, "");
      if (base64.length > 6_000_000) return json({ error: "Photo trop lourde." });
      const octets = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const { error } = await seau.upload(`originales/${nom}`, octets, { contentType: "image/jpeg", upsert: true });
      if (error) return json({ error: error.message });
      if (signee === true) {
        const { error: e2 } = await seau.upload(`cartes/${nom}`, octets, { contentType: "image/jpeg", upsert: true });
        if (e2) return json({ error: e2.message });
      }
      return json({ ok: true });
    }

    if (grande) {
      const { data } = await seau.createSignedUrl(`originales/${nom}`, 600);
      if (data?.signedUrl) return json({ url: data.signedUrl, grande: true });
    }
    const { data, error } = await seau.createSignedUrl(`cartes/${nom}`, 600);
    if (error) return json({ error: error.message });
    return json({ url: data.signedUrl });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
