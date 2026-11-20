// Fonction Edge : vraie photo d'un produit, cherchée d'abord dans les résultats de Google Images (service Serper,
// si sa clé est enregistrée), puis dans une offre de circulaire (recherche Flipp, non officielle).
// On ne renvoie une image que si son titre nomme la même marque, le produit, et exactement le même format.
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

const MODEL = Deno.env.get("ANTHROPIC_MODEL_RAPIDE") || "claude-haiku-5-5";
const OUTIL = {
  name: "choisir",
  description: "Indique le résultat qui montre exactement le produit demandé.",
  input_schema: { type: "object", properties: { index: { type: "integer" } }, required: ["index"] },
};
const CONSIGNE = `Tu choisis la photo d'un produit d'épicerie vendu au Québec.
On te donne un produit relevé sur une carte de prix (nom, marque, format) et une liste de résultats d'images avec leur titre.
Le nom sur une carte de prix est souvent abrégé, en français ou en anglais, et ne précise pas toujours la saveur.
Choisis le premier résultat dont le titre correspond à tout ce que le nom précise : même marque, même gamme, même type de produit, même format.
Refuse un résultat seulement si son titre contredit le nom : autre variété nommée (« original » au lieu de « boules de poils »),
autre type de produit (« 2 en 1 » au lieu de « revitalisant »), version « léger » ou « sans sucre » non demandée, autre format.
Si tous les résultats contredisent le nom, réponds -1. Appelle toujours l'outil choisir, une seule fois.`;

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
    // Sans marque ou sans format, on ne peut pas garantir que c'est le même produit.
    if (!motsMarque.length || !motsNom.length || !voulu) return json({ url: null });
    const memeFormat = (titre: string) => {
      const trouve = format(titre);
      return Boolean(trouve && trouve.base === voulu.base && Math.abs(trouve.quantite - voulu.quantite) <= 0.5);
    };
    let panne = false;

    // 1. Google Images (Serper) : même marque, même format, et au moins la moitié des mots du nom dans le titre.
    const { data: cle } = await sb.rpc("lire_cle_images");
    if (cle) {
      const rep = await fetch("https://google.serper.dev/images", {
        method: "POST",
        headers: { "X-API-KEY": cle, "Content-Type": "application/json" },
        body: JSON.stringify({ q: `${marque} ${nom} ${String(corps.format ?? "")}`.trim(), gl: "ca", hl: "fr", num: 20 }),
      });
      if (!rep.ok) panne = true;
      else {
        const data = await rep.json().catch(() => ({}));
        // Candidats : même marque et même format dans le titre, image dans un format que le navigateur affiche.
        const candidats: { url: string; titre: string; site: string | null; mots: number }[] = [];
        // deno-lint-ignore no-explicit-any
        for (const i of (Array.isArray(data?.images) ? data.images : []) as any[]) {
          const titre = String(i.title ?? "");
          const url = String(i.imageUrl ?? "");
          if (!/^https:\/\/[^\s"<>]+$/.test(url) || url.length > 500 || /\.(tiff?|gif|svg|bmp)(\?|$)/i.test(url)) continue;
          const texte = ` ${mots(titre).join(" ")} `;
          if (!motsMarque.every((m) => texte.includes(` ${m} `)) || !memeFormat(titre)) continue;
          candidats.push({ url, titre, site: i.domain ?? i.source ?? null, mots: motsNom.filter((m) => texte.includes(` ${m}`)).length });
          if (candidats.length >= 8) break;
        }
        if (candidats.length) {
          // Claude choisit le titre qui décrit exactement le même produit (même variété). Sans Claude : tous les mots du nom.
          let choix: number | null = null;
          const { data: cleClaude } = await sb.rpc("lire_cle_claude");
          if (cleClaude) {
            const r = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "x-api-key": cleClaude, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({
                model: MODEL, max_tokens: 200, system: CONSIGNE, tools: [OUTIL],
                messages: [{ role: "user", content: JSON.stringify({ produit: { nom, marque, format: String(corps.format ?? "") }, resultats: candidats.map((c, k) => ({ index: k, titre: c.titre })) }) }],
              }),
            });
            const msg = await r.json().catch(() => ({}));
            if (r.ok) {
              await sb.from("usage_claude").insert({ fonction: "image", modele: MODEL, photos: 0, entree: msg.usage?.input_tokens ?? 0, sortie: msg.usage?.output_tokens ?? 0 });
              // deno-lint-ignore no-explicit-any
              const bloc = (msg.content ?? []).find((x: any) => x.type === "tool_use");
              if (typeof bloc?.input?.index === "number") choix = bloc.input.index;
            }
          }
          const retenu = choix === null ? candidats.find((c) => c.mots === motsNom.length) : candidats[choix];
          if (retenu) return json({ url: retenu.url, titre: retenu.titre, source: "google", site: retenu.site });
        }
      }
    }

    // 2. Offre de circulaire (demande le code postal) : même marque, tous les mots du nom, même format.
    if (/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(codePostal)) {
      for (const q of [...new Set([`${marque} ${nom}`, `${marque} ${motsNom[0]}`])]) {
        const rep = await fetch(`https://backflipp.wishabi.com/flipp/items/search?locale=fr-ca&postal_code=${codePostal}&q=${encodeURIComponent(q)}`, { headers: { accept: "application/json" } });
        if (!rep.ok) { panne = true; continue; }
        const data = await rep.json().catch(() => ({}));
        // deno-lint-ignore no-explicit-any
        for (const i of (Array.isArray(data?.items) ? data.items : []) as any[]) {
          const titre = String(i.name ?? "");
          const url = String(i.clean_image_url ?? "");
          if (!url.startsWith("https://f.wishabi.net/")) continue;
          const texte = ` ${mots(titre).join(" ")} `;
          if (!motsMarque.every((m) => texte.includes(` ${m} `)) || !motsNom.every((m) => texte.includes(` ${m}`))) continue;
          if (!memeFormat(titre)) continue;
          return json({ url, titre, source: "circulaire", site: i.merchant_name ?? null });
        }
      }
    }
    return json({ url: null, panne });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
