# Scan Prix

Web app (PWA) pour iPhone : photographier des cartes de prix en magasin, laisser Claude Vision lire
le produit, le format, les prix, les promos, les dates et les codes, puis exporter le tout en Excel.

Stack : Next.js, Supabase (base de données, photos), API Claude, Vercel.

## Fonctionnement

1. **Nouvelle visite** : bannière, magasin, date.
2. **Photographier** : le bouton ouvre directement la caméra. Chaque photo est traitée en
   arrière-plan, on peut enchaîner les cartes sans attendre. Une photo peut contenir plusieurs cartes.
3. Toucher une ligne pour **corriger** (la photo originale est affichée). Les lectures incertaines
   portent la mention « à vérifier ».
4. **Excel** : exporte la visite en cours ; l'onglet Visites exporte une visite précise ou toutes les visites.
5. **Assistant** : onglet de discussion avec Claude pour résumer une visite, trouver les promos, comparer les visites ou corriger un prix.

## Installation

1. **Supabase** : créer un projet, puis exécuter `supabase/schema.sql` dans le SQL Editor.
2. **Vercel** : importer ce repo et ajouter les variables de `.env.example`
   (seule `ANTHROPIC_API_KEY` est requise : les valeurs Supabase publiques sont dans `.env.production`).
3. **iPhone** : ouvrir l'URL Vercel dans Safari > Partager > « Sur l'écran d'accueil ».

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
