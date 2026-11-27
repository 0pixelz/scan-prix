import { cupNormalise, normaliser } from "./comparaison";
import { prixParUnite, texteUnite } from "./unite";

/** Offre d'une circulaire renvoyée par la recherche (fonction « promos »). */
export type Offre = {
  banniere: string; nom: string; prix: number; prixOffre: number; quantite: number; texte: string | null;
  debut: string | null; fin: string | null; image: string | null; verdict: "identique" | "proche" | "a_confirmer"; format: string | null;
  lien?: string | null; // page de l'offre dans la circulaire en ligne
};

/** Lien d'une offre, seulement s'il mène bien à la circulaire en ligne. */
export const lienOffre = (lien: string | null | undefined) => (lien && /^https:\/\/flipp\.com\//.test(lien) ? lien : null);

/** Écart entre la promo et mon prix : au prix affiché si le format est le même, sinon au prix par unité quand c'est possible. */
export function ecartPromo(monPrix: number, monFormat: string | null, o: Pick<Offre, "verdict" | "prix" | "format">): { pct: number; parUnite: string | null } | null {
  if (!(monPrix > 0)) return null;
  if (o.verdict === "identique") return { pct: ((o.prix - monPrix) / monPrix) * 100, parUnite: null };
  const a = prixParUnite(monPrix, monFormat);
  const b = prixParUnite(o.prix, o.format);
  if (a && b && a.unite === b.unite && a.valeur > 0) return { pct: ((b.valeur - a.valeur) / a.valeur) * 100, parUnite: texteUnite(b) };
  return null; // format de l'offre inconnu : pas de comparaison chiffrée
}

/** Clé d'un produit pour retrouver ses promos gardées : le CUP s'il existe, sinon nom et marque. */
export function clePromo(p: { cup?: string | null; produit?: string | null; marque?: string | null }): string {
  const cup = cupNormalise(p.cup ?? null);
  return cup ? `cup:${cup}` : `nom:${normaliser(`${p.marque ?? ""} ${p.produit ?? ""}`)}`;
}

export const pctLisible = (v: number) => `${v > 0 ? "+" : ""}${v.toLocaleString("fr-CA", { maximumFractionDigits: 1 })} %`;
