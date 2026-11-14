-- Scan Prix — schéma Supabase
-- À exécuter une fois dans Supabase > SQL Editor.

create table if not exists public.visites (
  id uuid primary key default gen_random_uuid(),
    banniere text not null,
  magasin text,
  date_visite date not null default current_date,
  created_at timestamptz not null default now()
);

create table if not exists public.scans (
  id uuid primary key default gen_random_uuid(),
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

alter table public.visites enable row level security;
alter table public.scans enable row level security;

-- App à usage personnel, sans compte : accès ouvert à la clé publique.
create policy "visites sans compte" on public.visites for all to anon using (true) with check (true);
create policy "scans sans compte" on public.scans for all to anon using (true) with check (true);

-- Photos : bucket privé, dossier cartes/
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "photos sans compte" on storage.objects
  for all to anon
  using (bucket_id = 'photos')
  with check (bucket_id = 'photos');
