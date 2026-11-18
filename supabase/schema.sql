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

-- Catégorie et clé de regroupement (même produit d'un magasin à l'autre)
alter table public.scans add column if not exists categorie text;
alter table public.scans add column if not exists cle_produit text;
alter table public.scans add column if not exists photo_prise_le timestamptz; -- moment où la photo a été prise
alter table public.scans add column if not exists source text; -- « circulaire » pour un prix lu sur une page de circulaire
alter table public.scans add column if not exists prix_membre boolean; -- prix réservé aux membres
alter table public.scans add column if not exists points integer;      -- points de fidélité offerts
alter table public.scans add column if not exists points_details text; -- programme et condition
alter table public.scans add column if not exists icone text; -- type de produit (icône), choisi par Claude

-- Position GPS d'une visite : sert à reconnaître le magasin à la visite suivante
alter table public.visites add column if not exists latitude double precision;
alter table public.visites add column if not exists longitude double precision;

-- Liste de prix de référence (importée d'un fichier Excel ou CSV), par CUP sans zéros de tête
create table if not exists public.reference_prix (
  cup text primary key,
  nom text,
  prix numeric(10, 2) not null,
  importe_le timestamptz not null default now()
);
alter table public.reference_prix enable row level security;

-- Liste des produits à relever
create table if not exists public.liste_produits (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  cup text,
  created_at timestamptz not null default now()
);
alter table public.liste_produits enable row level security;

-- Code d'accès à 4 chiffres : échangé contre un jeton de session, vérifié à chaque requête (en-tête x-jeton).
-- Les tables du schéma « prive » ne sont jamais exposées par l'API.
create extension if not exists pgcrypto with schema extensions;
create schema if not exists prive;
create table if not exists prive.acces (id int primary key default 1 check (id = 1), code_hash text not null);
create table if not exists prive.sessions (jeton_hash text primary key, cree_le timestamptz not null default now());
create table if not exists prive.echecs (id bigserial primary key, quand timestamptz not null default now());

-- Pour définir ou changer le code (à exécuter à la main, jamais dans le dépôt) :
--   insert into prive.acces (id, code_hash) values (1, extensions.crypt('0000', extensions.gen_salt('bf', 10)))
--   on conflict (id) do update set code_hash = excluded.code_hash;
-- Pour déconnecter tous les appareils : delete from prive.sessions;

create or replace function public.jeton_valide()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from prive.sessions
    where jeton_hash = encode(sha256(convert_to(coalesce(current_setting('request.headers', true)::json ->> 'x-jeton', ''), 'UTF8')), 'hex')
  )
$$;

-- 5 échecs en 15 minutes = blocage temporaire.
create or replace function public.ouvrir_session(code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; j text;
begin
  if (select count(*) from prive.echecs where quand > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'bloque', true);
  end if;
  select code_hash into h from prive.acces where id = 1;
  if h is null or code is null or extensions.crypt(code, h) <> h then
    insert into prive.echecs default values;
    return jsonb_build_object('ok', false, 'bloque', false);
  end if;
  j := encode(extensions.gen_random_bytes(32), 'hex');
  insert into prive.sessions (jeton_hash) values (encode(sha256(convert_to(j, 'UTF8')), 'hex'));
  return jsonb_build_object('ok', true, 'jeton', j);
end $$;

-- Vérification d'un jeton par les fonctions Edge (rôle service_role seulement).
create or replace function public.verifier_jeton(jeton text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Acces refuse';
  end if;
  return exists (
    select 1 from prive.sessions
    where jeton_hash = encode(sha256(convert_to(coalesce(jeton, ''), 'UTF8')), 'hex')
  );
end $$;

-- Accès aux données : seulement avec un jeton de session valide.
create policy "visites sans compte" on public.visites for all to anon
  using ((select public.jeton_valide())) with check ((select public.jeton_valide()));
create policy "scans sans compte" on public.scans for all to anon
  using ((select public.jeton_valide())) with check ((select public.jeton_valide()));
create policy "liste avec jeton" on public.liste_produits for all to anon
  using ((select public.jeton_valide())) with check ((select public.jeton_valide()));
create policy "reference avec jeton" on public.reference_prix for all to anon
  using ((select public.jeton_valide())) with check ((select public.jeton_valide()));

-- Photos : bucket privé, lu et écrit uniquement par les fonctions Edge.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

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
