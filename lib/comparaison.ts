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
  if (s.groupe_manuel) k.push(`man:${s.groupe_manuel}`); // association faite à la main
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
  icone: string | null;
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
      icone: premier("icone"),
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

/** CUP réduit à ses chiffres, sans zéros de tête : même valeur quelle que soit la façon de l'écrire. */
export const cupNormalise = (cup: string | null | undefined) => (cup ?? "").replace(/\D/g, "").replace(/^0+/, "");

export type Variation = {
  groupe: Groupe;
  banniere: string;
  avant: ScanAvecVisite;
  apres: ScanAvecVisite;
  delta: number;
  pct: number;
};

/** Changements de prix : pour chaque produit et chaque bannière, le dernier relevé comparé au relevé de la visite précédente. */
export function variations(groupes: Groupe[]): Variation[] {
  const liste: Variation[] = [];
  for (const groupe of groupes) {
    const parBanniere = new Map<string, ScanAvecVisite[]>();
    for (const o of groupe.observations) {
      const b = o.visites?.banniere?.trim();
      if (!b || prixEffectif(o) === null) continue;
      const cle = normaliser(b);
      if (!parBanniere.has(cle)) parBanniere.set(cle, []);
      parBanniere.get(cle)!.push(o); // déjà triées, de la plus récente à la plus ancienne
    }
    for (const obs of parBanniere.values()) {
      const apres = obs[0];
      const avant = obs.find((o) => o.visite_id !== apres.visite_id);
      if (!avant) continue;
      const delta = prixEffectif(apres)! - prixEffectif(avant)!;
      if (Math.abs(delta) < 0.005) continue;
      liste.push({ groupe, banniere: apres.visites!.banniere, avant, apres, delta, pct: (delta / prixEffectif(avant)!) * 100 });
    }
  }
  return liste.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

export type IndiceBanniere = { banniere: string; indice: number; produits: number };

/**
 * Indice de prix par bannière sur les produits communs (relevés dans au moins deux bannières) :
 * 100 = la moyenne des bannières ; en dessous de 100 = moins cher que la moyenne.
 */
export function indices(lignes: LigneComparaison[]): IndiceBanniere[] {
  const cumul = new Map<string, { banniere: string; somme: number; n: number }>();
  for (const l of lignes) {
    if (l.parBanniere.length < 2) continue;
    const moyenne = l.parBanniere.reduce((s, b) => s + b.prix, 0) / l.parBanniere.length;
    if (moyenne <= 0) continue;
    for (const b of l.parBanniere) {
      const cle = normaliser(b.banniere);
      const c = cumul.get(cle) ?? { banniere: b.banniere, somme: 0, n: 0 };
      c.somme += b.prix / moyenne;
      c.n++;
      cumul.set(cle, c);
    }
  }
  return [...cumul.values()]
    .map((c) => ({ banniere: c.banniere, indice: (c.somme / c.n) * 100, produits: c.n }))
    .sort((a, b) => a.indice - b.indice);
}

export type StatBanniere = { banniere: string; prix: number; promos: number; membres: number; visites: number };

/** Nombre de prix, de promos et de visites par bannière. */
export function statsBannieres(scans: ScanAvecVisite[]): StatBanniere[] {
  const cumul = new Map<string, StatBanniere & { ids: Set<string> }>();
  for (const s of scans) {
    const b = s.visites?.banniere?.trim();
    if (!b) continue;
    const cle = normaliser(b);
    const c = cumul.get(cle) ?? { banniere: b, prix: 0, promos: 0, membres: 0, visites: 0, ids: new Set<string>() };
    c.prix++;
    if (s.prix_promo !== null) c.promos++;
    if (s.prix_membre) c.membres++;
    c.ids.add(s.visite_id);
    cumul.set(cle, c);
  }
  return [...cumul.values()].map(({ ids, ...c }) => ({ ...c, visites: ids.size })).sort((a, b) => b.prix - a.prix);
}

/** Distance en mètres entre deux positions GPS. */
export function distanceMetres(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(h));
}


export type Alerte = {
  groupe: Groupe;
  type: "reference" | "bannieres";
  banniere: string; // bannière dont le prix déclenche l'alerte
  obs: ScanAvecVisite;
  prix: number;
  base: number; // prix auquel on compare : ma référence, ou le prix le plus bas ailleurs
  baseNom: string;
  pct: number;
};

/**
 * Écarts qui dépassent le seuil (en %) : un prix relevé par rapport à ma référence,
 * et la bannière la plus chère par rapport à la moins chère pour un même produit.
 */
export function alertes(lignes: LigneComparaison[], reference: (cup: string | null) => number | undefined, seuil: number): Alerte[] {
  const liste: Alerte[] = [];
  for (const l of lignes) {
    const ref = reference(l.groupe.cup);
    if (ref && ref > 0) {
      for (const b of l.parBanniere) {
        const pct = ((b.prix - ref) / ref) * 100;
        if (Math.abs(pct) >= seuil) liste.push({ groupe: l.groupe, type: "reference", banniere: b.banniere, obs: b.obs, prix: b.prix, base: ref, baseNom: "Ma référence", pct });
      }
    }
    if (l.parBanniere.length > 1 && l.ecartPct >= seuil) {
      const cher = l.parBanniere[l.parBanniere.length - 1];
      liste.push({ groupe: l.groupe, type: "bannieres", banniere: cher.banniere, obs: cher.obs, prix: cher.prix, base: l.min, baseNom: l.parBanniere[0].banniere, pct: l.ecartPct });
    }
  }
  return liste.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

/** Image du produit d'un groupe : celle d'un de ses relevés, s'il y en a une. */
export const imageGroupe = (g: Groupe): string | null => g.observations.find((o) => o.image_produit)?.image_produit ?? null;
