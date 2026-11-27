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

// Marques maison des bannières présentes au Québec, par groupe (formes sans accents ni ponctuation). Un produit de
// marque maison se compare aussi au produit équivalent des marques maison des autres groupes.
const MARQUES_MAISON: Record<string, string[]> = {
  metro: ["selection", "irresistibles", "irresistible", "life smart", "mieux etre"],
  loblaw: ["sans nom", "no name", "choix du president", "president s choice", "le choix du president", "pc", "life brand"],
  sobeys: ["compliments", "panache", "sensations"],
  walmart: ["great value", "notre excellence", "our finest", "equate", "marketside"],
  costco: ["kirkland", "kirkland signature"],
  autres: ["personnelle", "giant value"],
};
// Ce qu'on tape dans la recherche pour trouver l'équivalent chez chaque groupe.
const RECHERCHE_MAISON: Record<string, string[]> = {
  metro: ["Selection", "Irresistibles"],
  loblaw: ["Sans nom", "Choix du Président"],
  sobeys: ["Compliments"],
  walmart: ["Great Value"],
  costco: ["Kirkland"],
};
const contient = (texte: string, marque: string) => ` ${texte} `.includes(` ${marque} `);
/** Groupe dont la marque est une marque maison, sinon null. */
function groupeMaison(marque: string | null): string | null {
  if (!marque) return null;
  const m = normaliser(marque);
  for (const [groupe, marques] of Object.entries(MARQUES_MAISON)) if (marques.some((x) => contient(m, x))) return groupe;
  return null;
}

type Produit = { id: string; nom: string; marque: string | null; format: string | null };
type Offre = {
  banniere: string; nom: string; prix: number; prixOffre: number; quantite: number; texte: string | null;
  debut: string | null; fin: string | null; image: string | null; verdict: "identique" | "equivalent" | "proche" | "a_confirmer"; format: string | null;
  maison: boolean; // offre d'une marque maison d'un autre groupe, pour un produit lui-même de marque maison
  lien: string | null; // page de l'offre dans la circulaire en ligne
  circulaire: number | null; x: number | null; // circulaire et position horizontale de l'offre, pour trouver sa page
  page: number | null; pages: number | null; // page de l'offre et nombre de pages de la circulaire
};

// Pages d'une circulaire (bornes gauche et droite de chacune), gardées en mémoire tant que la fonction reste active.
const pagesConnues = new Map<number, { g: number; d: number; n: number }[]>();
async function pagesDe(circulaire: number) {
  const connues = pagesConnues.get(circulaire);
  if (connues) return connues;
  try {
    const rep = await fetch(`https://backflipp.wishabi.com/flipp/flyers/${circulaire}?locale=fr-ca`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8000) });
    if (!rep.ok) return null;
    const corps = await rep.json();
    // deno-lint-ignore no-explicit-any
    const pages = (Array.isArray(corps?.pages) ? corps.pages : []).map((p: any) => ({ g: Number(p.left), d: Number(p.right), n: Number(p.page) }))
      .filter((p: { g: number; d: number; n: number }) => Number.isFinite(p.g) && Number.isFinite(p.d) && Number.isInteger(p.n) && p.n > 0);
    if (!pages.length) return null;
    pagesConnues.set(circulaire, pages);
    return pages as { g: number; d: number; n: number }[];
  } catch {
    return null;
  }
}

/** Note sur chaque offre sa page dans la circulaire (première, dernière ou intérieur). Sans réponse, rien n'est noté. */
async function situer(offres: Offre[]) {
  const ids = [...new Set(offres.map((o) => o.circulaire).filter((c): c is number => c !== null))].slice(0, 20);
  const trouvees = new Map<number, { g: number; d: number; n: number }[] | null>();
  await Promise.all(ids.map(async (id) => { trouvees.set(id, await pagesDe(id)); }));
  for (const o of offres) {
    const pages = o.circulaire !== null ? trouvees.get(o.circulaire) : null;
    if (!pages || o.x === null) continue;
    const x = o.x;
    const p = pages.find((q) => x >= q.g && x < q.d);
    if (p) {
      o.page = p.n;
      o.pages = Math.max(...pages.map((q) => q.n));
    }
  }
}

async function chercher(p: Produit, codePostal: string, exclure: Set<string>): Promise<Offre[]> {
  const motsNom = mots(p.nom);
  const motsMarque = p.marque ? mots(p.marque) : [];
  const groupe = groupeMaison(p.marque);
  // Deux recherches : le nom complet, puis une version courte (marque + premier mot), car la recherche exige tous les mots.
  const requetes = [...new Set([
    [p.marque, p.nom].filter(Boolean).join(" "),
    [p.marque, motsNom[0] ?? p.nom].filter(Boolean).join(" "),
  ])];
  // Produit de marque maison : on cherche aussi le même produit sous la marque maison des autres groupes.
  const court = motsNom.slice(0, 2).join(" ") || p.nom;
  const requetesMaison = groupe ? Object.entries(RECHERCHE_MAISON).filter(([g]) => g !== groupe).flatMap(([, ms]) => ms.map((m) => `${m} ${court}`)) : [];
  const autresMaison = groupe ? Object.entries(MARQUES_MAISON).filter(([g]) => g !== groupe).flatMap(([, ms]) => ms) : [];
  const maintenant = Date.now();
  const offres: Offre[] = [];
  const vues = new Set<string>();
  let reussies = 0;
  // deno-lint-ignore no-explicit-any
  const lire = async (q: string): Promise<any[] | null> => {
    const url = `https://backflipp.wishabi.com/flipp/items/search?locale=fr-ca&postal_code=${encodeURIComponent(codePostal)}&q=${encodeURIComponent(q)}`;
    const rep = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!rep || !rep.ok) return null;
    reussies++;
    const corps = await rep.json().catch(() => ({}));
    return Array.isArray(corps?.items) ? corps.items : [];
  };
  // deno-lint-ignore no-explicit-any
  const garder = (items: any[], maison: boolean, max: number) => {
    for (const i of items) {
      if (offres.length >= max) break;
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
      // Premier tri, large : la marque (ou une marque maison d'un autre groupe) et au moins un mot du nom doivent se retrouver dans l'offre.
      if (maison ? !autresMaison.some((m) => texteOffre.includes(` ${m} `)) : motsMarque.length && !motsMarque.some((m) => texteOffre.includes(` ${m} `))) continue;
      if (motsNom.length && !motsNom.some((m) => texteOffre.includes(m))) continue;
      vues.add(cle);
      const multiple = String(i.pre_price_text ?? "").match(/(\d+)\s*(?:pour|for|\/)/i);
      const quantite = multiple ? Math.max(1, parseInt(multiple[1], 10)) : 1;
      offres.push({
        banniere, nom, prixOffre, quantite, prix: Math.round((prixOffre / quantite) * 100) / 100,
        texte: [i.pre_price_text, i.post_price_text, i.sale_story].filter(Boolean).join(" · ") || null,
        debut: i.valid_from ?? null, fin: i.valid_to ?? null, image: i.clean_image_url ?? null,
        verdict: "a_confirmer", format: null, maison,
        lien: /^\d+$/.test(String(i.flyer_item_id ?? "")) ? `https://flipp.com/fr-ca/item/${i.flyer_item_id}` : null,
        circulaire: Number.isInteger(Number(i.flyer_id)) && Number(i.flyer_id) > 0 ? Number(i.flyer_id) : null,
        x: Number.isFinite(Number(i.left)) && Number.isFinite(Number(i.right)) ? (Number(i.left) + Number(i.right)) / 2 : null,
        page: null, pages: null,
      });
    }
  };
  for (const q of requetes) {
    const items = await lire(q);
    if (items) garder(items, false, 8);
  }
  const listes = await Promise.all(requetesMaison.map(lire));
  const limite = offres.length + 8;
  for (const items of listes) if (items) garder(items, true, limite);
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
            verdict: { type: "string", enum: ["identique", "equivalent", "proche", "non"] },
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
- equivalent : seulement si le produit est de marque maison (marqueMaison = true) et que l'offre est marquée maison = true : l'offre est le même type de produit, de même variété, sous la marque maison d'une autre bannière (ex. beurre d'arachide crémeux Selection et beurre d'arachide crémeux Great Value). Le format peut différer : la comparaison se fait au prix par unité.
- proche : même marque et même type de produit, mais le format ou la variété diffère, ou le format n'est pas écrit dans l'offre. Comparable au prix par unité.
- non : autre marque, autre type de produit, ou offre trop vague pour être comparée.
format : le format de l'offre s'il est écrit dans son nom (ex. « 454 g »), sinon null.
Une offre qui regroupe plusieurs produits (« A ou B ou C », « A, B ») compte dès que l'un d'eux est le produit ou sa marque et son type : juge sur celui-là, et réponds proche si le format ou la variété n'est pas précisé pour lui.
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
        produit: i, nom: p.nom, marque: p.marque, format: p.format, marqueMaison: groupeMaison(p.marque) !== null,
        offres: trouvees[i].map((o, k) => ({ offre: k, nom: o.nom, banniere: o.banniere, maison: o.maison })),
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
              // Une offre de marque maison d'un autre groupe ne peut être qu'« équivalente » ; les autres, identiques ou proches.
              if (o.maison) return v.verdict === "equivalent" || v.verdict === "identique" ? [{ ...o, verdict: "equivalent" as const, format: v.format }] : [];
              return [{ ...o, verdict: v.verdict === "identique" ? "identique" as const : "proche" as const, format: v.format }];
            });
          });
        }
      }
    }

    await situer(trouvees.flat());
    return json({ resultats: produits.map((p, i) => ({ id: p.id, offres: trouvees[i] })), juge, pannes });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Erreur inconnue" });
  }
});
