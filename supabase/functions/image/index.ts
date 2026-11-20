// Fonction Edge : image d'un produit sans code-barres, tirée d'une offre de circulaire (recherche Flipp, non officielle).
// On ne renvoie une image que si l'offre nomme la même marque, tous les mots du produit et exactement le même format.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jeton",
};
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });
const normaliser = (t: string) => t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9.,]+/g, " ").trim();
const mots = (t: string) => normaliser(t).replace(/[.,]/g, " ").split(" ").filter((m) => m.length >= 3 && !/^\d+$/.test(m));

/** Format lu dans un texte, ramené en grammes ou en millilitres (« 2 x 340 g » compte pour 680 g). */
function format(t: string): { quantite: number; base: "g" | "ml" } | null {
  const m = normaliser(t).match(/(?:(\d+)\s*x\s*)?(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b/);
  if (!m) return null;
  const facteur = m[3] === "kg" || m[3] === "l" ? 1000 : 1;
  return { quantite: (m[1] ? parseInt(m[1], 10) : 1) * parseFloat(m[2].replace(",", ".")) * facteur, base: m[3] === "kg" || m[3] === "g" ? "g" : "ml" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: role } = await sb.rpc("role_jeton", { jeton: req.headers.get("x-jeton") ?? "" });
    if (!role) return json({ error: "Accès refusé. Entre ton code à nouveau.", acces: false });
    const corps = await req.json().catch(() => ({}));
    const codePostal = String(corps.codePostal ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const nom = String(corps.nom ?? "").slice(0, 120);
    const marque = String(corps.marque ?? "").slice(0, 60);
    const voulu = format(String(corps.format ?? ""));
    const motsMarque = mots(marque);
    const motsNom = mots(nom).filter((m) => !motsMarque.includes(m));
    // Sans marque, sans format ou sans code postal, on ne peut pas garantir que c'est le même produit.
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(codePostal) || !motsMarque.length || !motsNom.length || !voulu) return json({ url: null });

    for (const q of [...new Set([`${marque} ${nom}`, `${marque} ${motsNom[0]}`])]) {
      const rep = await fetch(`https://backflipp.wishabi.com/flipp/items/search?locale=fr-ca&postal_code=${codePostal}&q=${encodeURIComponent(q)}`, { headers: { accept: "application/json" } });
      if (!rep.ok) continue;
      const data = await rep.json().catch(() => ({}));
      // deno-lint-ignore no-explicit-any
      for (const i of (Array.isArray(data?.items) ? data.items : []) as any[]) {
        const titre = String(i.name ?? "");
        const url = String(i.clean_image_url ?? "");
        if (!url.startsWith("https://f.wishabi.net/")) continue;
        const texte = ` ${mots(titre).join(" ")} `;
        if (!motsMarque.every((m) => texte.includes(` ${m} `)) || !motsNom.every((m) => texte.includes(` ${m}`))) continue;
        const trouve = format(titre);
        if (!trouve || trouve.base !== voulu.base || Math.abs(trouve.quantite - voulu.quantite) > 0.5) continue;
        return json({ url, titre, banniere: i.merchant_name ?? null });
      }
    }
    return json({ url: null });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
