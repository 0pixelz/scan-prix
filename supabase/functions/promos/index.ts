// Fonction Edge : cherche les promos en cours des circulaires (recherche Flipp, non officielle) pour des produits
// relevés, puis demande à Claude lesquelles concernent un produit comparable. Rien n'est enregistré :
// ce sont des suggestions à confirmer.
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-jeton",
};
const MODEL = Deno.env.get("ANTHROPIC_MODEL_RAPIDE") || "claude-haiku-5-5";
const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { ...cors, "Content-Type": "application/json" } });

const VIDES = new Set(["de", "du", "des", "la", "le", "les", "et", "ou", "au", "aux", "en", "avec", "sans", "pour", "the", "and"]);
const normaliser = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const mots = (t: string) => normaliser(t).split(" ").filter((m) => m.length >= 3 && !VIDES.has(m) && !/^\d+$/.test(m));

type Produit = { id: string; nom: string; marque: string | null; format: string | null };
type Offre = {
  banniere: string; nom: string; prix: number; prixOffre: number; quantite: number; texte: string | null;
  debut: string | null; fin: string | null; image: string | null; verdict: "identique" | "proche" | "a_confirmer"; format: string | null;
  lien: string | null; // page de l'offre dans la circulaire en ligne
};

async function chercher(p: Produit, codePostal: string, exclure: Set<string>): Promise<Offre[]> {
  const motsNom = mots(p.nom);
  const motsMarque = p.marque ? mots(p.marque) : [];
  // Deux recherches : le nom complet, puis une version courte (marque + premier mot), car la recherche exige tous les mots.
  const requetes = [...new Set([
    [p.marque, p.nom].filter(Boolean).join(" "),
    [p.marque, motsNom[0] ?? p.nom].filter(Boolean).join(" "),
  ])];
  const maintenant = Date.now();
  const offres: Offre[] = [];
  const vues = new Set<string>();
  let reussies = 0;
  for (const q of requetes) {
    const url = `https://backflipp.wishabi.com/flipp/items/search?locale=fr-ca&postal_code=${encodeURIComponent(codePostal)}&q=${encodeURIComponent(q)}`;
    const rep = await fetch(url, { headers: { accept: "application/json" } });
    if (!rep.ok) continue;
    reussies++;
    const corps = await rep.json().catch(() => ({}));
    // deno-lint-ignore no-explicit-any
    for (const i of (Array.isArray(corps?.items) ? corps.items : []) as any[]) {
      if (offres.length >= 8) break;
      const prixOffre = Number(i.current_price);
      const banniere = String(i.merchant_name ?? "").trim();
      const nom = String(i.name ?? "").trim();
      if (!banniere || !nom || !Number.isFinite(prixOffre) || prixOffre <= 0) continue;
      if (exclure.has(normaliser(banniere))) continue;
      if (i.valid_to && Date.parse(i.valid_to) < maintenant) continue;
      if (i.valid_from && Date.parse(i.valid_from) > maintenant + 86400000) continue;
      const cle = `${normaliser(banniere)}|${normaliser(nom)}|${prixOffre}`;
      if (vues.has(cle)) continue;
      const texteOffre = ` ${normaliser(nom)} `;
      // Premier tri, large : la marque (si connue) et au moins un mot du nom doivent se retrouver dans l'offre.
      if (motsMarque.length && !motsMarque.some((m) => texteOffre.includes(` ${m} `))) continue;
      if (motsNom.length && !motsNom.some((m) => texteOffre.includes(m))) continue;
      vues.add(cle);
      const multiple = String(i.pre_price_text ?? "").match(/(\d+)\s*(?:pour|for|\/)/i);
      const quantite = multiple ? Math.max(1, parseInt(multiple[1], 10)) : 1;
      offres.push({
        banniere, nom, prixOffre, quantite, prix: Math.round((prixOffre / quantite) * 100) / 100,
        texte: [i.pre_price_text, i.post_price_text, i.sale_story].filter(Boolean).join(" · ") || null,
        debut: i.valid_from ?? null, fin: i.valid_to ?? null, image: i.clean_image_url ?? null,
        verdict: "a_confirmer", format: null,
        lien: /^\d+$/.test(String(i.flyer_item_id ?? "")) ? `https://flipp.com/fr-ca/item/${i.flyer_item_id}` : null,
      });
    }
  }
  if (!reussies) throw new Error("Flipp ne répond pas");
  return offres;
}

const OUTIL = {
  name: "juger",
  description: "Enregistre le jugement de chaque paire produit / offre.",
  input_schema: {
    type: "object",
    properties: {
      jugements: {
        type: "array",
        items: {
          type: "object",
          properties: {
            produit: { type: "integer" }, offre: { type: "integer" },
            verdict: { type: "string", enum: ["identique", "proche", "non"] },
            format: { type: ["string", "null"] },
          },
          required: ["produit", "offre", "verdict"],
        },
      },
    },
    required: ["jugements"],
  },
};

const CONSIGNE = `Tu compares des produits d'épicerie relevés en magasin au Québec à des offres de circulaires.
Pour chaque paire (produit, offre), dis si l'offre concerne le même produit :
- identique : même marque, même produit, même variété, et le format écrit dans l'offre est le même que celui du produit.
- proche : même marque et même type de produit, mais le format ou la variété diffère, ou le format n'est pas écrit dans l'offre. Comparable au prix par unité.
- non : autre marque, autre type de produit, ou offre trop vague pour être comparée.
format : le format de l'offre s'il est écrit dans son nom (ex. « 454 g »), sinon null.
Dans le doute entre proche et non, réponds non.
Appelle toujours l'outil juger, une seule fois, avec toutes les paires reçues.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: role } = await sb.rpc("role_jeton", { jeton: req.headers.get("x-jeton") ?? "" });
    if (!role) return json({ error: "Accès refusé. Entre ton code à nouveau.", acces: false });
    const corps = await req.json().catch(() => ({}));
    const codePostal = String(corps.codePostal ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(codePostal)) return json({ error: "Code postal invalide (ex. H2X 1Y4)." });
    const produits: Produit[] = (Array.isArray(corps.produits) ? corps.produits : [])
      .filter((p: Produit) => p && typeof p.id === "string" && typeof p.nom === "string" && p.nom.trim())
      .slice(0, 30)
      .map((p: Produit) => ({ id: p.id, nom: p.nom.slice(0, 120), marque: p.marque ? String(p.marque).slice(0, 60) : null, format: p.format ? String(p.format).slice(0, 40) : null }));
    if (!produits.length) return json({ resultats: [], juge: false });
    const exclure = new Set<string>((Array.isArray(corps.exclure) ? corps.exclure : []).map((b: unknown) => normaliser(String(b))));

    // Recherche des offres, cinq produits à la fois
    const trouvees: Offre[][] = produits.map(() => []);
    let pannes = 0;
    for (let i = 0; i < produits.length; i += 5) {
      await Promise.all(produits.slice(i, i + 5).map(async (p, k) => {
        try { trouvees[i + k] = await chercher(p, codePostal, exclure); } catch { pannes++; }
      }));
    }
    if (pannes === produits.length) return json({ error: "La recherche de circulaires ne répond pas pour l'instant." });

    // Jugement par Claude : identique, proche ou non. Sans Claude, les offres restent « à confirmer ».
    let juge = false;
    const paires = trouvees.flatMap((offres, p) => offres.map((o, k) => ({ produit: p, offre: k, o })));
    const { data: cle } = paires.length ? await sb.rpc("lire_cle_claude") : { data: null };
    if (cle) {
      const liste = produits.map((p, i) => ({
        produit: i, nom: p.nom, marque: p.marque, format: p.format,
        offres: trouvees[i].map((o, k) => ({ offre: k, nom: o.nom, banniere: o.banniere })),
      })).filter((p) => p.offres.length);
      const rep = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": cle, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 4000, system: CONSIGNE, tools: [OUTIL], messages: [{ role: "user", content: JSON.stringify(liste) }] }),
      });
      const msg = await rep.json().catch(() => ({}));
      if (rep.ok) {
        await sb.from("usage_claude").insert({ fonction: "promos", modele: MODEL, photos: 0, entree: msg.usage?.input_tokens ?? 0, sortie: msg.usage?.output_tokens ?? 0 });
        // deno-lint-ignore no-explicit-any
        const bloc = (msg.content ?? []).find((b: any) => b.type === "tool_use");
        const jugements = Array.isArray(bloc?.input?.jugements) ? bloc.input.jugements : null;
        if (jugements) {
          juge = true;
          const verdicts = new Map<string, { verdict: string; format: string | null }>();
          for (const j of jugements) verdicts.set(`${j.produit}-${j.offre}`, { verdict: String(j.verdict), format: typeof j.format === "string" && j.format.trim() ? j.format.trim() : null });
          trouvees.forEach((offres, p) => {
            trouvees[p] = offres.flatMap((o, k) => {
              const v = verdicts.get(`${p}-${k}`);
              if (!v || v.verdict === "non") return []; // non jugée ou différente : écartée
              return [{ ...o, verdict: v.verdict === "identique" ? "identique" as const : "proche" as const, format: v.format }];
            });
          });
        }
      }
    }

    return json({ resultats: produits.map((p, i) => ({ id: p.id, offres: trouvees[i] })), juge, pannes });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
