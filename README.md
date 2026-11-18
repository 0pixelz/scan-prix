# Scan Prix

Web app (PWA) pour iPhone : photographier des cartes de prix en magasin, laisser Claude Vision lire
le produit, le format, les prix, les promos, les dates et les codes, puis exporter le tout en Excel.

Stack : Next.js sur Vercel, Supabase (base de données, photos, fonctions Edge), API Claude.

## Fonctionnement

- **Code d'accès** : un code à 4 chiffres est demandé une fois par appareil. Il est vérifié par le serveur
  (5 essais ratés bloquent l'accès 15 minutes) ; sans lui, ni les données ni Claude ne sont accessibles.
- **Prix** : choisir ou créer une visite (bannière, magasin, date). À la création, la position GPS est notée :
  à la visite suivante au même endroit (moins de 200 m), le magasin est reconnu et prérempli.
- **Photographier** : scanner en continu avec cadre de visée, capture automatique, zoom manuel et zoom
  automatique quand la carte est loin. **Importer** : photos de cartes déjà prises, ou page de circulaire
  (toutes les offres de la page sont lues d'un coup).
- **Hors ligne** : chaque photo est gardée sur l'appareil jusqu'à ce qu'elle soit lue. Sans réseau, les photos
  attendent et partent toutes seules au retour de la connexion, même si l'app a été fermée entre-temps.
- **Révision rapide** : toucher « À vérifier » fait défiler les lectures incertaines une par une, photo en haut.
- Toucher une ligne pour **corriger**, agrandir la photo (version haute résolution), scanner le **code-barres**
  ou voir l'**historique** du produit. Chaque prix affiche son **prix par unité** (100 g, 100 ml ou unité).
- **Liste** : produits à relever ; ils se cochent tout seuls quand ils sont scannés dans la visite en cours.
- **Analyse** :
  - *Comparer* : le même produit côte à côte dans chaque bannière, écart en dollars et en pourcentage ;
  - *Tableau de bord* : indice de prix par bannière sur les produits communs, relevés et taux de promos ;
  - *Variations* : hausses et baisses depuis la visite précédente dans la même bannière ;
  - *Référence* : import d'un fichier Excel ou CSV (colonnes CUP et Prix) ; chaque relevé affiche son écart.
- **Assistant** : discussion avec Claude pour résumer, comparer, corriger, gérer la liste, ou lire une photo.
- **Prix membre et points** : repérés par Claude, affichés sur chaque prix et dans l'Excel.
- **Excel** : quatre onglets — Résumé par visite, Comparaison entre bannières, Variations, Prix (données brutes
  avec prix par unité, source carte ou circulaire, prix de référence et écart).

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

## Logos des bannières

Les logos de `public/bannieres/` sont des marques de commerce de leurs propriétaires respectifs. Ils servent
uniquement à reconnaître les magasins dans cette app à usage personnel.
