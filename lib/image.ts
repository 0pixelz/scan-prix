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
export const sourceImage = (url: string) => (url.includes("wishabi") ? "circulaire (Flipp)" : url.includes("openfoodfacts") ? "Open Food Facts" : "base ouverte Open Facts");

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

/**
 * Image d'un produit, dans l'ordre : par code-barres dans les bases ouvertes, par description exacte dans
 * Open Food Facts, puis dans une offre de circulaire au même format (si le code postal est réglé).
 * Renvoie undefined si un service ne répondait pas (à réessayer), null si rien d'exact n'existe.
 */
export async function chercherImage(sb: SupabaseClient, s: { cup: string | null; produit: string | null; marque: string | null; format: string | null }, codePostal?: string): Promise<string | null | undefined> {
  if (s.cup) {
    const parCode = await imageProduit(s.cup);
    if (parCode) return parCode;
  }
  const parTexte = await imageParDescription(s.produit, s.marque, s.format);
  if (parTexte) return parTexte;
  if (codePostal && s.produit && s.marque && s.format) {
    const { data, error } = await sb.functions.invoke("image", { body: { nom: s.produit, marque: s.marque, format: s.format, codePostal } });
    if (error) return undefined;
    if (typeof data?.url === "string" && data.url.startsWith("https://f.wishabi.net/")) return data.url;
  }
  return parTexte;
}
