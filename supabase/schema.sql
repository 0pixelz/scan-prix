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

-- =====================================================================================
-- Association manuelle, listes multiples, corbeille, suivi du coût, accès collègue, réglages
-- =====================================================================================

-- Produits associés à la main : deux prix qui ont la même valeur sont le même produit.
alter table public.scans add column if not exists groupe_manuel text;

-- Listes de produits à relever (liste_id nul = liste principale).
create table if not exists public.listes (
  id uuid primary key default gen_random_uuid(),
  nom text not null,
  created_at timestamptz not null default now()
);
alter table public.listes enable row level security;
alter table public.liste_produits add column if not exists liste_id uuid references public.listes(id) on delete cascade;

-- Corbeille : copie de chaque prix ou visite supprimé, gardée 30 jours. « lot » regroupe ce qui a été
-- supprimé ensemble (une visite et ses prix).
create table if not exists public.corbeille (
  id uuid primary key default gen_random_uuid(),
  type text not null,
  objet_id uuid not null,
  donnees jsonb not null,
  lot bigint not null default txid_current(),
  supprime_le timestamptz not null default now()
);
alter table public.corbeille enable row level security;

-- Jetons utilisés par chaque appel à Claude (écrit par les fonctions Edge).
create table if not exists public.usage_claude (
  id bigint generated always as identity primary key,
  quand timestamptz not null default now(),
  fonction text not null,
  modele text not null,
  entree int not null default 0,
  sortie int not null default 0,
  photos int not null default 0
);
alter table public.usage_claude enable row level security;

-- Réglages de l'app (signature des photos, seuil d'alerte, tarifs) : une seule ligne.
create table if not exists public.reglages (
  id int primary key check (id = 1),
  donnees jsonb not null default '{}'::jsonb,
  modifie_le timestamptz not null default now()
);
alter table public.reglages enable row level security;

-- Code d'un collègue (un seul), avec son type d'accès. Le code principal reste dans prive.acces.
create table if not exists prive.codes (
  id int primary key check (id = 1),
  code_hash text not null,
  role text not null check (role in ('complet', 'lecture')),
  cree_le timestamptz not null default now()
);
alter table prive.sessions add column if not exists role text not null default 'complet';
alter table prive.sessions add column if not exists collegue boolean not null default false;

-- Type d'accès du jeton envoyé : « complet » ou « lecture ».
create or replace function public.jeton_role()
returns text language sql stable security definer set search_path = '' as $$
  select role from prive.sessions
  where jeton_hash = encode(sha256(convert_to(coalesce(current_setting('request.headers', true)::json ->> 'x-jeton', ''), 'UTF8')), 'hex')
$$;

create or replace function public.jeton_ecriture()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.jeton_role() = 'complet', false)
$$;

create or replace function prive.est_proprietaire()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from prive.sessions
    where not collegue and role = 'complet'
      and jeton_hash = encode(sha256(convert_to(coalesce(current_setting('request.headers', true)::json ->> 'x-jeton', ''), 'UTF8')), 'hex')
  )
$$;

-- Pour les fonctions Edge (rôle service_role seulement).
create or replace function public.role_jeton(jeton text)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Acces refuse';
  end if;
  return (select role from prive.sessions where jeton_hash = encode(sha256(convert_to(coalesce(jeton, ''), 'UTF8')), 'hex'));
end $$;

-- Ouverture de session : le code principal donne l'accès complet, le code du collègue donne son type d'accès.
-- (Remplace la version plus haut.)
create or replace function public.ouvrir_session(code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; j text; r text; c boolean := false; k record;
begin
  if (select count(*) from prive.echecs where quand > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'bloque', true);
  end if;
  select code_hash into h from prive.acces where id = 1;
  if h is not null and code is not null and extensions.crypt(code, h) = h then
    r := 'complet';
  else
    select * into k from prive.codes where id = 1;
    if found and code is not null and extensions.crypt(code, k.code_hash) = k.code_hash then
      r := k.role;
      c := true;
    end if;
  end if;
  if r is null then
    insert into prive.echecs default values;
    return jsonb_build_object('ok', false, 'bloque', false);
  end if;
  j := encode(extensions.gen_random_bytes(32), 'hex');
  insert into prive.sessions (jeton_hash, role, collegue) values (encode(sha256(convert_to(j, 'UTF8')), 'hex'), r, c);
  return jsonb_build_object('ok', true, 'jeton', j, 'role', r);
end $$;

create or replace function public.etat_acces()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', public.jeton_role(),
    'proprietaire', prive.est_proprietaire(),
    'collegue', case when prive.est_proprietaire() then (select jsonb_build_object('role', role, 'cree_le', cree_le) from prive.codes where id = 1) end
  )
$$;

-- Code du collègue : créé, remplacé ou retiré seulement avec le code principal.
create or replace function public.definir_code_collegue(code text, role text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text;
begin
  if not prive.est_proprietaire() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  if code is null or code !~ '^[0-9]{4}$' then return jsonb_build_object('ok', false, 'erreur', 'format'); end if;
  if role not in ('complet', 'lecture') then return jsonb_build_object('ok', false, 'erreur', 'role'); end if;
  select code_hash into h from prive.acces where id = 1;
  if h is not null and extensions.crypt(code, h) = h then return jsonb_build_object('ok', false, 'erreur', 'identique'); end if;
  insert into prive.codes (id, code_hash, role, cree_le) values (1, extensions.crypt(code, extensions.gen_salt('bf', 10)), role, now())
  on conflict (id) do update set code_hash = excluded.code_hash, role = excluded.role, cree_le = now();
  delete from prive.sessions where collegue;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.retirer_code_collegue()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not prive.est_proprietaire() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  delete from prive.codes where id = 1;
  delete from prive.sessions where collegue;
  return jsonb_build_object('ok', true);
end $$;

-- Corbeille : chaque suppression d'un prix ou d'une visite y laisse une copie.
create or replace function prive.vers_corbeille()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.corbeille (type, objet_id, donnees) values (tg_table_name, old.id, to_jsonb(old));
  return old;
end $$;
create or replace trigger scans_corbeille before delete on public.scans for each row execute function prive.vers_corbeille();
create or replace trigger visites_corbeille before delete on public.visites for each row execute function prive.vers_corbeille();

create or replace function public.restaurer(corbeille_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; n int := 0;
begin
  if not public.jeton_ecriture() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  select * into c from public.corbeille where id = corbeille_id;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'introuvable'); end if;
  if c.type = 'visites' then
    insert into public.visites select * from jsonb_populate_record(null::public.visites, c.donnees);
    insert into public.scans
      select (jsonb_populate_record(null::public.scans, k.donnees)).* from public.corbeille k
      where k.type = 'scans' and k.lot = c.lot and k.donnees ->> 'visite_id' = c.objet_id::text;
    get diagnostics n = row_count;
    delete from public.corbeille k where k.id = c.id or (k.type = 'scans' and k.lot = c.lot and k.donnees ->> 'visite_id' = c.objet_id::text);
  else
    if not exists (select 1 from public.visites v where v.id = (c.donnees ->> 'visite_id')::uuid) then
      return jsonb_build_object('ok', false, 'erreur', 'visite');
    end if;
    insert into public.scans select * from jsonb_populate_record(null::public.scans, c.donnees);
    delete from public.corbeille where id = c.id;
    n := 1;
  end if;
  return jsonb_build_object('ok', true, 'prix', n);
end $$;

create or replace function public.vider_corbeille()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.jeton_ecriture() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  delete from public.corbeille where true;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.purger_corbeille()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.jeton_valide() then
    delete from public.corbeille where supprime_le < now() - interval '30 days';
  end if;
end $$;

revoke execute on function public.role_jeton(text) from public, anon, authenticated;

-- Accès : lecture avec un jeton valide, écriture seulement avec un accès complet.
-- Les politiques des tables visites, scans, liste_produits et reference_prix (plus haut) deviennent :
--   using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()))
-- et une politique restrictive réserve la suppression à l'accès complet.
alter policy "visites sans compte" on public.visites using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()));
alter policy "scans sans compte" on public.scans using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()));
alter policy "liste avec jeton" on public.liste_produits using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()));
alter policy "reference avec jeton" on public.reference_prix using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()));
create policy "listes avec jeton" on public.listes for all to anon
  using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()));
create policy "reglages avec jeton" on public.reglages for all to anon
  using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()));
create policy "corbeille en lecture" on public.corbeille for select to anon using ((select public.jeton_valide()));
create policy "usage en lecture" on public.usage_claude for select to anon using ((select public.jeton_valide()));
create policy "suppression complet seulement" on public.visites as restrictive for delete to anon using ((select public.jeton_ecriture()));
create policy "suppression complet seulement" on public.scans as restrictive for delete to anon using ((select public.jeton_ecriture()));
create policy "suppression complet seulement" on public.liste_produits as restrictive for delete to anon using ((select public.jeton_ecriture()));
create policy "suppression complet seulement" on public.reference_prix as restrictive for delete to anon using ((select public.jeton_ecriture()));
create policy "suppression complet seulement" on public.listes as restrictive for delete to anon using ((select public.jeton_ecriture()));
create policy "suppression complet seulement" on public.reglages as restrictive for delete to anon using ((select public.jeton_ecriture()));
