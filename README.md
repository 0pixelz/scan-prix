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
- **Excel** : six onglets — Résumé par visite, Comparaison entre bannières, Alertes, Circulaires, Variations, Prix (données brutes
  avec prix par unité, source carte ou circulaire, prix de référence et écart).

- **Historique d'un produit** : graphique d'évolution du prix (une ligne par bannière) et liste des relevés.
  « Associer à un autre produit » regroupe à la main deux produits écrits différemment ; l'association se défait.
- **Alertes** (onglet Analyse) : écarts égaux ou supérieurs au seuil choisi, par rapport à la liste de référence
  et entre bannières. Aussi dans l'Excel (onglet Alertes).
- **Rapport de visite** : PDF d'une page ou plus (résumé, changements de prix, alertes, prix relevés).
- **Recherche** : la recherche de l'onglet Prix montre aussi les produits des autres visites.
- **Plusieurs listes** à relever, en plus de la liste principale.
- **Corbeille** : les prix et les visites supprimés sont récupérables pendant 30 jours ; « Annuler » juste après
  une suppression.
- **Réglages** (onglet Visites) :
  - *Signature des photos* : logo, nom, poste ou équipe, date et heure de la photo, lieu (facultatif), en bas à
    gauche de la photo gardée. L'image envoyée en lecture reste sans signature. Peut être désactivée.
  - *Coût Claude* : photos lues, messages et coût estimé du mois, à partir des jetons comptés.
  - *Accès collègue* : deuxième code à 4 chiffres, en lecture seule ou complet, retirable à tout moment.

  - *Apparence* : thème automatique, clair ou sombre, et taille du texte (gardés sur l'appareil).
- **Gestes** : glisser une ligne vers la gauche pour la supprimer (récupérable), vers la droite pour la marquer
  vérifiée ; tirer vers le bas pour actualiser. Le bouton de photo est au centre de la barre du bas.

- **Secours pour la lecture des photos** : si Claude ne répond pas (crédits épuisés, panne), la photo est lue par
  Gemini quand le secret GitHub `GEMINI_API_KEY` a été envoyé avec le flux « Enregistrer la clé de secours ».

- **Circulaires** (onglet Analyse) : pour les produits de la visite, cherche les promos en cours chez les autres
  bannières (recherche Flipp, non officielle), garde les produits comparables (jugés par Claude) et montre l'écart
  avec le prix de référence ou le relevé. La dernière recherche est gardée : ses écarts apparaissent dans Alertes,
  l'Excel (onglet Circulaires) et le rapport de visite. Ce sont des suggestions à confirmer.

- **Photo du produit** : quand le code-barres est lu, l'image du vrai produit est cherchée dans Open Food Facts
  (base ouverte) et remplace l'icône. Le CUP imprimé sans chiffre de contrôle est complété automatiquement.
  Sans code-barres, la recherche se fait par description et ne garde qu'une correspondance exacte (marque, nom, format).

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
