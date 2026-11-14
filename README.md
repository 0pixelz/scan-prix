# Scan Prix

Web app (PWA) pour iPhone : photographier des cartes de prix en magasin, laisser Claude Vision lire
le produit, le format, les prix, les promos, les dates et les codes, puis exporter le tout en Excel.

Stack : Next.js, Supabase (connexion, base de données, photos), API Claude, Vercel.

## Fonctionnement

1. **Nouvelle visite** : bannière, magasin, date.
2. **Photographier** : le bouton ouvre directement la caméra. Chaque photo est traitée en
   arrière-plan, on peut enchaîner les cartes sans attendre. Une photo peut contenir plusieurs cartes.
3. Toucher une ligne pour **corriger** (la photo originale est affichée). Les lectures incertaines
   portent la mention « à vérifier ».
4. **Excel** : exporte la visite en cours ; **Excel (tout)** : toutes les visites.

## Installation

1. **Supabase** : créer un projet, puis exécuter `supabase/schema.sql` dans le SQL Editor.
   Pour se connecter sans courriel de confirmation : Authentication > Sign In / Providers > Email >
   désactiver « Confirm email ».
2. **Vercel** : importer ce repo et ajouter les variables de `.env.example`
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`).
3. **iPhone** : ouvrir l'URL Vercel dans Safari > Partager > « Sur l'écran d'accueil ».
4. Créer son compte dans l'app. Ensuite, désactiver les inscriptions dans Supabase
   (Authentication > Sign In / Providers > « Allow new users to sign up ») pour garder l'app privée.

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
