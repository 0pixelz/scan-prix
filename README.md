# Scan Prix

Web app (PWA) pour iPhone : photographier des cartes de prix en magasin, laisser Claude Vision lire
le produit, le format, les prix, les promos, les dates et les codes, puis exporter le tout en Excel.

Stack : Next.js sur Vercel, Supabase (base de données, photos, fonctions Edge), API Claude.

## Fonctionnement

- **Code d'accès** : un code à 4 chiffres est demandé une fois par appareil. Il est vérifié par le serveur
  (5 essais ratés bloquent l'accès 15 minutes) ; sans lui, ni les données ni Claude ne sont accessibles.
- **Prix** : choisir ou créer une visite (bannière, magasin, date), puis **Photographier** (la caméra s'ouvre
  directement) ou **Importer** plusieurs photos déjà prises. Chaque photo est lue en arrière-plan ; une photo
  peut contenir plusieurs cartes. Recherche, filtres (promos, à vérifier, doublons, catégorie) et détection
  des doublons dans la visite.
- Toucher une ligne pour **corriger** (photo originale affichée), scanner le **code-barres** avec la caméra,
  ou voir l'**historique** du produit.
- **Liste** : produits à relever ; ils se cochent tout seuls quand ils sont scannés dans la visite en cours.
- **Comparer** : le même produit côte à côte dans chaque bannière (dernier prix relevé), avec l'écart en
  dollars et en pourcentage.
- **Assistant** : discussion avec Claude pour résumer, comparer, corriger, gérer la liste, ou lire une photo.
- **Excel** : trois onglets — Résumé par visite, Comparaison entre bannières, Prix (données brutes).

## Installation

1. **Supabase** : exécuter `supabase/schema.sql` dans le SQL Editor, définir le code d'accès (commande en
   commentaire dans ce fichier), puis déployer les fonctions Edge de `supabase/functions/`.
2. **Clé Claude** : ajouter le secret `ANTHROPIC_API_KEY` dans GitHub (Settings > Secrets and variables >
   Actions), puis lancer le workflow « Enregistrer la clé Claude ». La clé est gardée chiffrée dans
   Supabase Vault ; elle n'est ni dans le code ni dans Vercel.
3. **Vercel** : importer ce repo (aucune variable à ajouter).
4. **iPhone** : ouvrir l'URL Vercel dans Safari > Partager > « Sur l'écran d'accueil ».

## En local

```bash
cp .env.example .env.local   # remplir les valeurs
npm install
npm run dev
```

## Reconnaître un même produit

Deux relevés sont considérés comme le même produit s'ils ont le même CUP, ou la même clé normalisée
(marque, nom et format, sans accents ni ordre des mots). Pour une offre « 2 pour 5,00 $ », le prix comparé
est le prix à l'unité (2,50 $).
