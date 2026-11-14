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

-- Clé API Claude : gardée chiffrée dans Supabase Vault.
-- definir_cle_claude : écriture seule, une seule fois (appelée par le workflow GitHub).
create or replace function public.definir_cle_claude(cle text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if cle is null or cle !~ '^sk-ant-[A-Za-z0-9_-]{20,}$' then
    raise exception 'Cle invalide';
  end if;
  if exists (select 1 from vault.secrets where name = 'anthropic_api_key') then
    raise exception 'Une cle est deja enregistree';
  end if;
  perform vault.create_secret(cle, 'anthropic_api_key', 'Cle API Claude pour Scan Prix');
  return 'ok';
end $$;

-- lire_cle_claude : réservée au rôle service_role (fonctions Edge).
create or replace function public.lire_cle_claude()
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Acces refuse';
  end if;
  select decrypted_secret into r from vault.decrypted_secrets where name = 'anthropic_api_key' limit 1;
  return r;
end $$;

revoke execute on function public.lire_cle_claude() from public, anon, authenticated;
revoke execute on function public.definir_cle_claude(text) from public, authenticated;
