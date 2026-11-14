-- Scan Prix — schéma Supabase
-- À exécuter une fois dans Supabase > SQL Editor.

create table if not exists public.visites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  banniere text not null,
  magasin text,
  date_visite date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  visite_id uuid not null references public.visites (id) on delete cascade,
  produit text,
  marque text,
  format text,
  prix_regulier numeric(10, 2),
  prix_promo numeric(10, 2),      -- prix total de l'offre (ex. 5.00 pour « 2 pour 5 $ »)
  promo_quantite integer,          -- quantité de l'offre (ex. 2 pour « 2 pour 5 $ »)
  promo_texte text,
  date_debut date,
  date_fin date,
  cup text,
  code_article text,
  prix_unitaire text,              -- ex. « 1,25 $ / 100 g » tel qu'affiché
  confiance text,
  notes text,
  photo_path text,
  created_at timestamptz not null default now()
);

create index if not exists scans_visite_idx on public.scans (visite_id, created_at desc);
create index if not exists visites_user_idx on public.visites (user_id, date_visite desc);

alter table public.visites enable row level security;
alter table public.scans enable row level security;

drop policy if exists "visites proprietaire" on public.visites;
create policy "visites proprietaire" on public.visites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "scans proprietaire" on public.scans;
create policy "scans proprietaire" on public.scans
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Photos : bucket privé, un dossier par utilisateur (<user_id>/<fichier>.jpg)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

drop policy if exists "photos proprietaire" on storage.objects;
create policy "photos proprietaire" on storage.objects
  for all to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
