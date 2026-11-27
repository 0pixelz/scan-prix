import { cupNormalise, normaliser } from "./comparaison";
import { prixParUnite, texteUnite } from "./unite";

/** Offre d'une circulaire renvoyée par la recherche (fonction « promos »). */
export type Offre = {
  banniere: string; nom: string; prix: number; prixOffre: number; quantite: number; texte: string | null;
  debut: string | null; fin: string | null; image: string | null; verdict: "identique" | "equivalent" | "proche" | "a_confirmer"; format: string | null;
  maison?: boolean; // marque maison équivalente d'une autre bannière
  lien?: string | null; // page de l'offre dans la circulaire en ligne
  page?: number | null; pages?: number | null; // page de l'offre et nombre de pages de la circulaire
};

/** Emplacement de l'offre dans la circulaire, dans les termes du métier : front page, back page ou intérieur. */
export function emplacementOffre(o: Pick<Offre, "page" | "pages">): string | null {
  if (!o.page || !o.pages || o.page > o.pages) return null;
  if (o.page === 1) return "Front page";
  if (o.page === o.pages) return "Back page";
  return `Intérieur · p. ${o.page}`;
}

/** Lien d'une offre, seulement s'il mène bien à la circulaire en ligne. */
/** Image de l'offre telle qu'imprimée dans la circulaire, si elle vient bien du service de circulaires. */
export const imageOffre = (image: string | null | undefined) => (image && /^https:\/\/[a-z0-9.-]+\.wishabi\.(net|com)\//.test(image) ? image : null);

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

const sansAccent = (t: string) => t.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

// Recherche d'un produit sur le site de la bannière (adresses de recherche publiques de chaque site).
const SITES: Record<string, (q: string) => string> = {
  maxi: (q) => `https://www.maxi.ca/fr/search?search-bar=${q}`,
  provigo: (q) => `https://www.provigo.ca/fr/search?search-bar=${q}`,
  metro: (q) => `https://www.metro.ca/recherche?filter=${q}`,
  superc: (q) => `https://www.superc.ca/recherche?filter=${q}`,
  iga: (q) => `https://www.iga.net/fr/search?k=${q}`,
  walmart: (q) => `https://www.walmart.ca/fr/search?q=${q}`,
  costco: (q) => `https://www.costco.ca/CatalogSearch?dept=All&langId=-25&keyword=${q}`,
  pharmaprix: (q) => `https://www.pharmaprix.ca/fr/search?text=${q}`, // site québécois (Shoppers Drug Mart ailleurs au Canada)
};

// Bannières absentes du Québec : leurs offres sont écartées, même si une circulaire d'une autre province remonte.
const HORS_QUEBEC = new Set([
  "shoppersdrugmart", "foodbasics", "nofrills", "freshco", "loblaws", "realcanadiansuperstore", "zehrs", "fortinos",
  "yourindependentgrocer", "valumart", "freshmart", "sobeys", "foodland", "farmboy", "longos", "rexall", "safeway",
  "saveonfoods", "atlanticsuperstore", "dominion", "londondrugs", "thriftyfoods", "coop", "wholesaleclub", "nations",
]);
/** Vrai si la bannière a des magasins au Québec (ou n'est pas connue comme absente du Québec). */
export const auQuebec = (banniere: string) => !HORS_QUEBEC.has(sansAccent(banniere));

/**
 * Lien vers le produit sur le site du concurrent : la recherche de son site avec la marque et le nom du produit.
 * Pour une bannière sans site connu ici : une recherche web du produit chez cette bannière.
 */
export function lienSite(banniere: string, produit: { marque?: string | null; produit?: string | null }): { libelle: string; href: string } {
  const q = encodeURIComponent([produit.marque, produit.produit].filter(Boolean).join(" ").trim());
  const site = SITES[sansAccent(banniere)];
  return site
    ? { libelle: `Voir sur le site de ${banniere}`, href: site(q) }
    : { libelle: `Chercher chez ${banniere} sur le web`, href: `https://www.google.com/search?q=${encodeURIComponent(`${banniere} Québec`)}+${q}` };
}

/** Libellé et style de l'étiquette d'un verdict. */
export function etiquetteVerdict(verdict: Offre["verdict"], compare: boolean): { texte: string; style: string } {
  if (verdict === "identique") return { texte: "Identique", style: "baisse" };
  if (verdict === "equivalent") return { texte: "Marque maison équivalente", style: "membre" };
  if (verdict === "proche") return { texte: compare ? "Proche · comparé par unité" : "Proche · format à confirmer", style: "verif" };
  return { texte: "À confirmer", style: "verif" };
}
