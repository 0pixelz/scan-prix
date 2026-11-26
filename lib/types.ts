export type Visite = {
  id: string;
  banniere: string;
  magasin: string | null;
  date_visite: string;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
  espace?: string | null; // téléphone d'un collègue (nul : code principal)
};

export type Scan = {
  id: string;
  visite_id: string;
  produit: string | null;
  marque: string | null;
  format: string | null;
  prix_regulier: number | null;
  prix_promo: number | null;
  promo_quantite: number | null;
  promo_texte: string | null;
  prix_membre: boolean | null;
  points: number | null;
  points_details: string | null;
  date_debut: string | null;
  date_fin: string | null;
  cup: string | null;
  code_article: string | null;
  prix_unitaire: string | null;
  categorie: string | null;
  cle_produit: string | null;
  icone: string | null;
  confiance: string | null;
  notes: string | null;
  photo_path: string | null;
  photo_prise_le: string | null;
  image_produit?: string | null; // image du produit trouvée par son code-barres (Open Food Facts)
  groupe_manuel?: string | null; // produits associés à la main : même valeur = même produit
  source: string | null; // « circulaire » pour un prix lu sur une page de circulaire
  created_at: string;
};

export type ScanAvecVisite = Scan & {
  visites: { id: string; banniere: string; magasin: string | null; date_visite: string } | null;
};

export type Reference = { cup: string; nom: string | null; prix: number };

export type ProduitListe = { id: string; nom: string; cup: string | null; liste_id?: string | null; created_at: string };

/** Promo de circulaire gardée après une recherche (onglet Analyse > Circulaires). */
export type PromoCirculaire = {
  id: string; visite_id: string | null; produit: string; marque: string | null; format: string | null; cup: string | null;
  mon_prix: number; source_prix: string | null; banniere: string; offre: string; prix: number; prix_offre: number | null;
  quantite: number; format_offre: string | null; verdict: string; ecart_pct: number | null; par_unite: string | null;
  fin: string | null; trouve_le: string;
};

export type ListeNom = { id: string; nom: string; created_at: string };

/** Signature ajoutée au bas des photos gardées (jamais sur l'image envoyée en lecture). */
export type Filigrane = { actif: boolean; logo: boolean; nom: string; poste: string; lieu: boolean; opacite: number }; // opacité en %, de 20 à 100

/** Tarifs Claude en dollars US par million de jetons, pour estimer le coût. */
export type Tarifs = { sonnetEntree: number; sonnetSortie: number; haikuEntree: number; haikuSortie: number };

export type Reglages = { filigrane: Filigrane; seuil: number; tarifs: Tarifs; codePostal: string; lecteur: "claude" | "gemini" }; // lecteur : qui lit les photos en premier // code postal : région des circulaires

export const REGLAGES_DEFAUT: Reglages = {
  filigrane: { actif: false, logo: true, nom: "", poste: "", lieu: false, opacite: 90 },
  seuil: 5,
  tarifs: { sonnetEntree: 2, sonnetSortie: 10, haikuEntree: 0.1, haikuSortie: 0.5 },
  codePostal: "",
  lecteur: "claude",
};

/** Réglages lus dans la base, complétés par les valeurs par défaut. */
export function lireReglages(donnees: unknown): Reglages {
  const d = (donnees && typeof donnees === "object" ? donnees : {}) as Partial<Reglages>;
  const seuil = Number(d.seuil);
  const filigrane = { ...REGLAGES_DEFAUT.filigrane, ...(d.filigrane ?? {}) };
  const opacite = Number(filigrane.opacite);
  filigrane.opacite = Number.isFinite(opacite) ? Math.min(100, Math.max(20, Math.round(opacite))) : 90;
  return {
    filigrane,
    seuil: Number.isFinite(seuil) && seuil > 0 ? seuil : REGLAGES_DEFAUT.seuil,
    tarifs: { ...REGLAGES_DEFAUT.tarifs, ...(d.tarifs ?? {}) },
    codePostal: typeof d.codePostal === "string" ? d.codePostal : "",
    lecteur: d.lecteur === "gemini" ? "gemini" : "claude",
  };
}

export type Acces = { role: "complet" | "lecture" | null; proprietaire: boolean; espace?: boolean; espaces?: { id: string; numero: number }[] | null; invitations?: number | null; collegue: { role: "complet" | "lecture"; cree_le: string } | null };

export const CATEGORIES = [
  "Fruits et légumes",
  "Viandes et poissons",
  "Produits laitiers et œufs",
  "Boulangerie",
  "Épicerie",
  "Surgelés",
  "Boissons",
  "Collations et confiseries",
  "Prêt-à-manger et charcuterie",
  "Santé et beauté",
  "Entretien ménager",
  "Bébé",
  "Animaux",
  "Autre",
];
