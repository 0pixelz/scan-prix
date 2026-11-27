import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliser } from "./comparaison";
import { lireFormat } from "./unite";

/**
 * Image d'un produit à partir de son code-barres, dans Open Food Facts (base ouverte, sans clé).
 * Les cartes de prix impriment souvent le CUP sans son dernier chiffre (le chiffre de contrôle) :
 * on essaie le code tel quel, puis le code complété.
 */

/** CUP à 12 chiffres avec son chiffre de contrôle, calculé à partir des 11 premiers. */
export function cupComplet(onze: string): string {
  let somme = 0;
  for (let i = 0; i < 11; i++) somme += Number(onze[i]) * (i % 2 === 0 ? 3 : 1);
  return onze + String((10 - (somme % 10)) % 10);
}

/** Codes à essayer pour un CUP lu sur une carte. */
export function codesPossibles(cup: string | null | undefined): string[] {
  const chiffres = (cup ?? "").replace(/\D/g, "");
  if (chiffres.length < 8) return [];
  const coeur = chiffres.replace(/^0+/, "");
  const codes = [chiffres];
  // Un code de 12 chiffres est déjà complet ; sinon on ajoute le chiffre de contrôle aux 11 chiffres utiles.
  if (chiffres.length !== 12 && coeur.length >= 6 && coeur.length <= 11) codes.push(cupComplet(coeur.padStart(11, "0")));
  return [...new Set(codes)];
}

// Bases ouvertes interrogées dans l'ordre : aliments, puis produits pour animaux, produits courants et soins.
const BASES = ["world.openfoodfacts.org", "world.openpetfoodfacts.org", "world.openproductsfacts.org", "world.openbeautyfacts.org"];
const imagePermise = (url: unknown): url is string => typeof url === "string" && /^https:\/\/images\.open(food|petfood|products|beauty)facts\.org\//.test(url);

/** Adresse de l'image en grand, pour l'agrandissement. */
export const imageEnGrand = (url: string) => url.replace(/\.(200|400)\.jpg$/, ".full.jpg");

/** D'où vient l'image, pour l'afficher sous la photo. */
export function sourceImage(url: string): string {
  if (url.includes("wishabi")) return "circulaire (Flipp)";
  if (url.includes("openfoodfacts")) return "Open Food Facts";
  if (/open(petfood|products|beauty)facts/.test(url)) return "base ouverte Open Facts";
  try { return `Google Images (${new URL(url).hostname.replace(/^www\./, "")})`; } catch { return "Google Images"; }
}

/** Adresse de la petite image du produit, ou null s'il n'est dans aucune base. */
export async function imageProduit(cup: string | null | undefined): Promise<string | null> {
  const codes = codesPossibles(cup);
  for (const base of BASES) {
    for (const code of codes) {
      try {
        const rep = await fetch(`https://${base}/api/v2/product/${code}.json?fields=code,image_front_small_url`);
        if (!rep.ok) continue;
        const url = (await rep.json())?.product?.image_front_small_url;
        if (imagePermise(url)) return url;
      } catch { /* hors ligne ou service indisponible : on réessaiera plus tard */ return null; }
    }
  }
  return null;
}

/** Nom d'un produit d'après son code-barres (bases ouvertes Open Facts) : marque, nom et format, ou null s'il est inconnu. */
export async function nomParCode(cup: string | null | undefined): Promise<string | null> {
  const codes = codesPossibles(cup);
  for (const base of BASES) {
    for (const code of codes) {
      try {
        const rep = await fetch(`https://${base}/api/v2/product/${code}.json?fields=code,product_name_fr,product_name,brands,quantity`, { signal: AbortSignal.timeout(6000) });
        if (!rep.ok) continue;
        const p = (await rep.json())?.product;
        const nom = String(p?.product_name_fr || p?.product_name || "").trim();
        if (!nom) continue;
        const marque = String(p?.brands ?? "").split(",")[0].trim();
        const dejaMarque = marque && normaliser(nom).includes(normaliser(marque));
        return [dejaMarque ? null : marque, nom, String(p?.quantity ?? "").trim()].filter(Boolean).join(" ").slice(0, 120);
      } catch { return null; }
    }
  }
  return null;
}

export type NutriScore = "A" | "B" | "C" | "D" | "E";
export type Niveau = "low" | "moderate" | "high";
/** Nutri-Score d'un aliment et ce qui l'explique : valeurs pour 100 g et niveaux (faible, modéré, élevé). */
export type Nutrition = {
  note: NutriScore;
  points: number | null; // pointage du Nutri-Score : plus il est bas, meilleur est le produit
  valeurs: { cle: string; nom: string; valeur: number; unite: string; niveau: Niveau | null }[];
};

export const SENS_NUTRI: Record<NutriScore, string> = {
  A: "Très bonne qualité nutritionnelle",
  B: "Bonne qualité nutritionnelle",
  C: "Qualité nutritionnelle moyenne",
  D: "Qualité nutritionnelle faible",
  E: "Qualité nutritionnelle très faible",
};

const NUTRIMENTS: [cle: string, nom: string, unite: string, niveau: string | null][] = [
  ["energy-kcal_100g", "Calories", "kcal", null],
  ["fat_100g", "Lipides", "g", "fat"],
  ["saturated-fat_100g", "Gras saturés", "g", "saturated-fat"],
  ["sugars_100g", "Sucres", "g", "sugars"],
  ["salt_100g", "Sel", "g", "salt"],
  ["fiber_100g", "Fibres", "g", null],
  ["proteins_100g", "Protéines", "g", null],
];

/**
 * Nutri-Score d'un aliment d'après son code-barres (Open Food Facts), ou null s'il est inconnu.
 * Gardé en mémoire sur l'appareil : 30 jours s'il est trouvé, 7 jours sinon.
 */
export async function nutriScore(cup: string | null | undefined): Promise<Nutrition | null> {
  const codes = codesPossibles(cup);
  if (!codes.length) return null;
  const cle = `scanprix.nutrition.${codes[0]}`;
  try {
    const garde = JSON.parse(localStorage.getItem(cle) ?? "null") as { n: Nutrition | null; t: number } | null;
    if (garde && Date.now() - garde.t < (garde.n ? 30 : 7) * 86400000) return garde.n;
  } catch { /* mémoire illisible : on redemande */ }
  let trouve: Nutrition | null = null;
  for (const code of codes) {
    try {
      const rep = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,nutriscore_grade,nutrition_grades,nutriscore_score,nutrient_levels,nutriments`, { signal: AbortSignal.timeout(6000) });
      if (!rep.ok) continue;
      const p = (await rep.json())?.product;
      const lettre = String(p?.nutriscore_grade || p?.nutrition_grades || "").trim().toUpperCase();
      if (!/^[A-E]$/.test(lettre)) continue;
      const n = (p?.nutriments ?? {}) as Record<string, unknown>;
      const niveaux = (p?.nutrient_levels ?? {}) as Record<string, unknown>;
      const valeurs = NUTRIMENTS.flatMap(([k, nom, unite, niv]) => {
        const v = Number(n[k]);
        if (n[k] === undefined || n[k] === null || n[k] === "" || !Number.isFinite(v) || v < 0) return [];
        const niveau = niv && /^(low|moderate|high)$/.test(String(niveaux[niv])) ? (String(niveaux[niv]) as Niveau) : null;
        return [{ cle: k, nom, valeur: v, unite, niveau }];
      });
      const points = Number(p?.nutriscore_score);
      trouve = { note: lettre as NutriScore, points: p?.nutriscore_score !== undefined && Number.isFinite(points) ? points : null, valeurs };
      break;
    } catch { return null; } // hors ligne : on réessaiera, sans rien retenir
  }
  try { localStorage.setItem(cle, JSON.stringify({ n: trouve, t: Date.now() })); } catch { /* mémoire pleine */ }
  return trouve;
}

const mots = (t: string | null | undefined) => normaliser(t ?? "").split(" ").filter((m) => m.length >= 3 && !/^\d+$/.test(m));

/**
 * Sans code-barres : recherche par description, et on ne garde qu'une correspondance exacte —
 * même marque, tous les mots du nom, et même format quand il est connu. Sinon, pas d'image
 * (une mauvaise photo serait pire que l'icône).
 * Renvoie undefined si le service ne répond pas : on pourra réessayer plus tard.
 */
export async function imageParDescription(nom: string | null, marque: string | null, format: string | null): Promise<string | null | undefined> {
  const motsMarque = mots(marque);
  const motsNom = mots(nom).filter((m) => !motsMarque.includes(m));
  if (!motsMarque.length || !motsNom.length) return null;
  let produits: Record<string, unknown>[];
  try {
    const q = encodeURIComponent(`${marque} ${nom}`);
    const rep = await fetch(`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1&page_size=12&fields=product_name,product_name_fr,generic_name_fr,brands,quantity,image_front_small_url,countries_tags`);
    if (!rep.ok) return undefined;
    produits = (await rep.json())?.products ?? [];
  } catch {
    return undefined;
  }
  const voulu = lireFormat(format);
  const canadiens = (p: Record<string, unknown>) => (Array.isArray(p.countries_tags) && p.countries_tags.includes("en:canada") ? 0 : 1);
  for (const p of [...produits].sort((a, b) => canadiens(a) - canadiens(b))) {
    const url = p.image_front_small_url;
    if (!imagePermise(url)) continue;
    const marques = ` ${normaliser(String(p.brands ?? ""))} `;
    if (!motsMarque.every((m) => marques.includes(` ${m} `))) continue;
    const texte = ` ${normaliser([p.product_name_fr, p.product_name, p.generic_name_fr].filter(Boolean).join(" "))} `;
    if (!motsNom.every((m) => texte.includes(` ${m}`))) continue;
    if (voulu) {
      const trouve = lireFormat(String(p.quantity ?? ""));
      if (!trouve || trouve.base !== voulu.base || Math.abs(trouve.quantite - voulu.quantite) > voulu.quantite * 0.02) continue;
    }
    return url;
  }
  return null;
}

// Produits déjà cherchés sans succès, gardés sur l'appareil : on ne refait pas la recherche avant 30 jours
// (chaque recherche compte dans le quota du service d'images).
const CLE_ESSAIS = "scanprix.imagesEssayees";
const lireEssais = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(CLE_ESSAIS) ?? "{}") as Record<string, number>; } catch { return {}; }
};
export const cleImage = (s: { cup: string | null; produit: string | null; marque: string | null; format: string | null }) =>
  s.cup ? `cup:${s.cup}` : `desc:${s.marque}|${s.produit}|${s.format}`;
export const dejaEssaye = (cle: string) => Date.now() - (lireEssais()[cle] ?? 0) < 7 * 86400000;
export function noterEssai(cle: string) {
  try {
    const essais = Object.entries({ ...lireEssais(), [cle]: Date.now() }).sort((a, b) => b[1] - a[1]).slice(0, 3000);
    localStorage.setItem(CLE_ESSAIS, JSON.stringify(Object.fromEntries(essais)));
  } catch { /* stockage indisponible */ }
}

/**
 * Image d'un produit, dans l'ordre : vraie photo trouvée par la fonction « image » (Google Images, puis offre de
 * circulaire, toujours au même format), puis par code-barres dans les bases ouvertes, puis par description exacte
 * dans Open Food Facts.
 * Renvoie undefined si un service ne répondait pas (à réessayer), null si rien d'exact n'existe.
 */
export async function chercherImage(sb: SupabaseClient, s: { cup: string | null; produit: string | null; marque: string | null; format: string | null }, codePostal?: string): Promise<string | null | undefined> {
  let aReessayer = false;
  if (s.produit && s.marque && s.format) {
    const { data, error } = await sb.functions.invoke("image", { body: { nom: s.produit, marque: s.marque, format: s.format, codePostal: codePostal ?? "" } });
    if (error || data?.panne) aReessayer = true;
    if (typeof data?.url === "string" && data.url.startsWith("https://")) return data.url;
  }
  if (s.cup) {
    const parCode = await imageProduit(s.cup);
    if (parCode) return parCode;
  }
  const parTexte = await imageParDescription(s.produit, s.marque, s.format);
  if (parTexte) return parTexte;
  return aReessayer || parTexte === undefined ? undefined : null;
}
