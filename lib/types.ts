export type Visite = {
  id: string;
  banniere: string;
  magasin: string | null;
  date_visite: string;
  created_at: string;
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
  date_debut: string | null;
  date_fin: string | null;
  cup: string | null;
  code_article: string | null;
  prix_unitaire: string | null;
  categorie: string | null;
  cle_produit: string | null;
  confiance: string | null;
  notes: string | null;
  photo_path: string | null;
  created_at: string;
};

export type ScanAvecVisite = Scan & {
  visites: { id: string; banniere: string; magasin: string | null; date_visite: string } | null;
};

export type ProduitListe = { id: string; nom: string; cup: string | null; created_at: string };

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
