import type { Scan, ScanAvecVisite } from "./types";

/** Minuscules, sans accents, mots triés : « Beurre salé 454g » et « beurre sale 454 g » donnent la même clé. */
export function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

const cleTriee = (texte: string) => [...new Set(normaliser(texte).split(" ").filter(Boolean))].sort().join(" ");

/** Clés servant à reconnaître un même produit : le CUP s'il existe, et la clé normalisée. */
export function cles(s: Scan): string[] {
  const k: string[] = [];
  const cup = (s.cup ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (cup.length >= 6) k.push(`cup:${cup}`);
  const cle = cleTriee(s.cle_produit || [s.marque, s.produit, s.format].filter(Boolean).join(" "));
  if (cle) k.push(`cle:${cle}`);
  return k;
}

/** Prix promo ramené à l'unité (2 pour 5 $ -> 2,50 $). */
export function promoUnitaire(s: Scan): number | null {
  if (s.prix_promo === null) return null;
  return Number(s.prix_promo) / (s.promo_quantite && s.promo_quantite > 1 ? s.promo_quantite : 1);
}

/** Prix réellement payé à l'unité : la promo si elle existe, sinon le prix régulier. */
export function prixEffectif(s: Scan): number | null {
  return promoUnitaire(s) ?? (s.prix_regulier === null ? null : Number(s.prix_regulier));
}

export type Groupe = {
  id: string;
  nom: string;
  marque: string | null;
  format: string | null;
  categorie: string | null;
  cup: string | null;
  observations: ScanAvecVisite[]; // de la plus récente à la plus ancienne
};

const dateObs = (s: ScanAvecVisite) => `${s.visites?.date_visite ?? ""} ${s.created_at}`;

/** Regroupe les scans par produit (deux scans qui partagent une clé sont le même produit). */
export function grouper(scans: ScanAvecVisite[]): Groupe[] {
  const parent = new Map<string, string>();
  const racine = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  for (const s of scans) {
    const k = cles(s);
    for (const c of k) if (!parent.has(c)) parent.set(c, c);
    for (let i = 1; i < k.length; i++) parent.set(racine(k[i]), racine(k[0]));
  }
  const groupes = new Map<string, ScanAvecVisite[]>();
  for (const s of scans) {
    const k = cles(s);
    const id = k.length ? racine(k[0]) : `seul:${s.id}`;
    if (!groupes.has(id)) groupes.set(id, []);
    groupes.get(id)!.push(s);
  }
  return [...groupes.entries()].map(([id, obs]) => {
    obs.sort((a, b) => dateObs(b).localeCompare(dateObs(a)));
    const premier = <K extends keyof Scan>(champ: K) => (obs.find((o) => o[champ])?.[champ] ?? null) as Scan[K];
    return {
      id,
      nom: premier("produit") || "Produit non lu",
      marque: premier("marque"),
      format: premier("format"),
      categorie: premier("categorie"),
      cup: premier("cup"),
      observations: obs,
    };
  });
}

export type LigneComparaison = {
  groupe: Groupe;
  parBanniere: { banniere: string; obs: ScanAvecVisite; prix: number }[]; // du moins cher au plus cher
  min: number;
  max: number;
  ecart: number;
  ecartPct: number;
};

/** Pour chaque produit, le dernier prix relevé dans chaque bannière. */
export function comparer(groupes: Groupe[]): LigneComparaison[] {
  const lignes: LigneComparaison[] = [];
  for (const groupe of groupes) {
    const vus = new Map<string, { banniere: string; obs: ScanAvecVisite; prix: number }>();
    for (const obs of groupe.observations) {
      const banniere = obs.visites?.banniere?.trim();
      const prix = prixEffectif(obs);
      if (!banniere || prix === null) continue;
      const cle = normaliser(banniere);
      if (!vus.has(cle)) vus.set(cle, { banniere, obs, prix }); // observations triées : la première est la plus récente
    }
    if (!vus.size) continue;
    const parBanniere = [...vus.values()].sort((a, b) => a.prix - b.prix);
    const min = parBanniere[0].prix;
    const max = parBanniere[parBanniere.length - 1].prix;
    lignes.push({ groupe, parBanniere, min, max, ecart: max - min, ecartPct: min > 0 ? ((max - min) / min) * 100 : 0 });
  }
  return lignes.sort((a, b) => b.ecartPct - a.ecartPct || a.groupe.nom.localeCompare(b.groupe.nom));
}

/** Scans en double dans une même visite : tout scan qui partage une clé avec un scan plus ancien. */
export function doublons(scans: Scan[]): Set<string> {
  const vus = new Set<string>();
  const ids = new Set<string>();
  for (const s of [...scans].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const k = cles(s);
    if (k.some((c) => vus.has(c))) ids.add(s.id);
    k.forEach((c) => vus.add(c));
  }
  return ids;
}

/** Vrai si un scan correspond à un produit de la liste à relever. */
export function correspond(item: { nom: string; cup: string | null }, s: Scan): boolean {
  const cupItem = (item.cup ?? "").replace(/\D/g, "").replace(/^0+/, "");
  const cupScan = (s.cup ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (cupItem && cupScan && cupItem === cupScan) return true;
  const mots = normaliser(item.nom).split(" ").filter(Boolean);
  if (!mots.length) return false;
  const texte = normaliser([s.produit, s.marque, s.format, s.cle_produit].filter(Boolean).join(" "));
  return mots.every((m) => texte.includes(m));
}
