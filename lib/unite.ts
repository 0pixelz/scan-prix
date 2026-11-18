/** Prix par unité normalisé : permet de comparer des formats différents (454 g contre 500 g). */

type Base = "g" | "ml" | "un";

const UNITES: Record<string, { base: Base; facteur: number }> = {
  g: { base: "g", facteur: 1 }, gr: { base: "g", facteur: 1 }, gramme: { base: "g", facteur: 1 }, grammes: { base: "g", facteur: 1 },
  kg: { base: "g", facteur: 1000 }, kilo: { base: "g", facteur: 1000 }, kilos: { base: "g", facteur: 1000 },
  mg: { base: "g", facteur: 0.001 },
  lb: { base: "g", facteur: 453.592 }, lbs: { base: "g", facteur: 453.592 }, livre: { base: "g", facteur: 453.592 }, livres: { base: "g", facteur: 453.592 },
  oz: { base: "g", facteur: 28.3495 },
  ml: { base: "ml", facteur: 1 }, cl: { base: "ml", facteur: 10 },
  l: { base: "ml", facteur: 1000 }, litre: { base: "ml", facteur: 1000 }, litres: { base: "ml", facteur: 1000 },
  un: { base: "un", facteur: 1 }, unite: { base: "un", facteur: 1 }, unites: { base: "un", facteur: 1 }, u: { base: "un", facteur: 1 },
  ch: { base: "un", facteur: 1 }, chacun: { base: "un", facteur: 1 }, pk: { base: "un", facteur: 1 }, pqt: { base: "un", facteur: 1 },
  rouleau: { base: "un", facteur: 1 }, rouleaux: { base: "un", facteur: 1 }, sachet: { base: "un", facteur: 1 }, sachets: { base: "un", facteur: 1 },
  capsule: { base: "un", facteur: 1 }, capsules: { base: "un", facteur: 1 }, feuille: { base: "un", facteur: 1 }, feuilles: { base: "un", facteur: 1 },
  comprime: { base: "un", facteur: 1 }, comprimes: { base: "un", facteur: 1 }, oeufs: { base: "un", facteur: 1 }, tranches: { base: "un", facteur: 1 },
};

const nettoyer = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/(\d),(\d)/g, "$1.$2").trim();

/** Lit un format (« 454 g », « 1,59 kg », « 12 x 355 ml », « 6 un », « kg ») : quantité dans l'unité de base. */
export function lireFormat(format: string | null | undefined): { quantite: number; base: Base } | null {
  if (!format) return null;
  const f = nettoyer(format);
  const paquet = f.match(/(\d+(?:\.\d+)?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (paquet && UNITES[paquet[3]]) {
    const u = UNITES[paquet[3]];
    return { quantite: Number(paquet[1]) * Number(paquet[2]) * u.facteur, base: u.base };
  }
  const simple = f.match(/(\d+(?:\.\d+)?)\s*([a-z]+)/);
  if (simple && UNITES[simple[2]]) {
    const u = UNITES[simple[2]];
    const quantite = Number(simple[1]) * u.facteur;
    return quantite > 0 ? { quantite, base: u.base } : null;
  }
  // Vendu au poids : « kg », « lb », « /kg », « le kg »
  const seul = f.replace(/^(\/|le |la |au |par )/, "").trim();
  if (UNITES[seul] && UNITES[seul].base !== "un") return { quantite: UNITES[seul].facteur, base: UNITES[seul].base };
  return null;
}

export type PrixUnite = { valeur: number; unite: "100 g" | "100 ml" | "unité" };

/** Prix ramené à 100 g, 100 ml ou à l'unité. */
export function prixParUnite(prix: number | null, format: string | null | undefined): PrixUnite | null {
  const f = lireFormat(format);
  if (prix === null || !f) return null;
  if (f.base === "un") return f.quantite > 1 ? { valeur: prix / f.quantite, unite: "unité" } : null;
  return { valeur: (prix / f.quantite) * 100, unite: f.base === "g" ? "100 g" : "100 ml" };
}

export const texteUnite = (p: PrixUnite) =>
  `${p.valeur.toLocaleString("fr-CA", { style: "currency", currency: "CAD", maximumFractionDigits: p.valeur < 1 ? 3 : 2 })} / ${p.unite}`;
