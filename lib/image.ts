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
