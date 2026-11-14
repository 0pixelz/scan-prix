# Scan Prix

Web app (PWA) pour iPhone : photographier des cartes de prix en magasin, laisser Claude Vision lire
le produit, le format, les prix, les promos, les dates et les codes, puis exporter le tout en Excel.

Stack : Next.js sur Vercel, Supabase (base de données, photos, fonctions Edge), API Claude.

## Fonctionnement

1. **Nouvelle visite** : bannière, magasin, date.
2. **Photographier** : le bouton ouvre directement la caméra. **Importer** permet de choisir plusieurs photos
   déjà prises dans la photothèque. Chaque photo est traitée en
   arrière-plan, on peut enchaîner les cartes sans attendre. Une photo peut contenir plusieurs cartes.
3. Toucher une ligne pour **corriger** (la photo originale est affichée). Les lectures incertaines
   portent la mention « à vérifier ».
4. **Excel** : exporte la visite en cours ; l'onglet Visites exporte une visite précise ou toutes les visites.
5. **Assistant** : onglet de discussion avec Claude pour résumer une visite, trouver les promos, comparer les visites ou corriger un prix. On peut aussi lui envoyer la photo d'une carte : il la lit et ajoute le prix.

## Installation

1. **Supabase** : exécuter `supabase/schema.sql` dans le SQL Editor, puis déployer les fonctions Edge
   `supabase/functions/scan` et `supabase/functions/assistant`.
2. **Clé Claude** : ajouter le secret `ANTHROPIC_API_KEY` dans GitHub (Settings > Secrets and variables >
   Actions), puis lancer le workflow « Enregistrer la clé Claude ». La clé est gardée chiffrée dans
   Supabase Vault ; elle n'est ni dans le code ni dans Vercel.
3. **Vercel** : importer ce repo (aucune variable à ajouter).
4. **iPhone** : ouvrir l'URL Vercel dans Safari > Partager > « Sur l'écran d'accueil ».

L'app est à usage personnel : aucun compte, quiconque connaît l'URL peut l'utiliser.

## En local

```bash
cp .env.example .env.local   # remplir les valeurs
npm install
npm run dev
```

## Colonnes de l'export

Date visite, Bannière, Magasin, Produit, Marque, Format, Prix régulier, Prix promo, Qté promo,
Prix promo unitaire (formule), Offre, Début, Fin, CUP, Code article, Prix unitaire affiché,
Confiance, Notes, Scanné le.

Pour une offre « 2 pour 5,00 $ » : Prix promo = 5,00, Qté promo = 2, Prix promo unitaire = 2,50.
