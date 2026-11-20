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

/** Adresse de la petite image du produit, ou null s'il n'est pas dans la base. */
export async function imageProduit(cup: string | null | undefined): Promise<string | null> {
  for (const code of codesPossibles(cup)) {
    try {
      const rep = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,image_front_small_url`);
      if (!rep.ok) continue;
      const url = (await rep.json())?.product?.image_front_small_url;
      if (typeof url === "string" && url.startsWith("https://images.openfoodfacts.org/")) return url;
    } catch { /* hors ligne ou service indisponible : on réessaiera plus tard */ return null; }
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
    if (typeof url !== "string" || !url.startsWith("https://images.openfoodfacts.org/")) continue;
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
