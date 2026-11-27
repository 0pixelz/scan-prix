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

-- Clé du service de secours (Gemini), lue par la fonction scan quand Claude n'est pas disponible.
-- Même principe que la clé Claude : écrite une seule fois par le flux GitHub, lue par service_role seulement.
create or replace function public.definir_cle_secours(cle text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if cle is null or cle !~ '^[A-Za-z0-9_-]{20,200}$' then
    raise exception 'Cle invalide';
  end if;
  if exists (select 1 from vault.secrets where name = 'gemini_api_key') then
    raise exception 'Une cle est deja enregistree';
  end if;
  perform vault.create_secret(cle, 'gemini_api_key', 'Cle API Gemini (secours) pour Scan Prix');
  return 'ok';
end $$;

create or replace function public.lire_cle_secours()
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Acces refuse';
  end if;
  select decrypted_secret into r from vault.decrypted_secrets where name = 'gemini_api_key' limit 1;
  return r;
end $$;
revoke execute on function public.lire_cle_secours() from public, anon, authenticated;

-- Image du produit (trouvée par son code-barres dans Open Food Facts), affichée à la place de l'icône.
alter table public.scans add column if not exists image_produit text;

-- Promos des circulaires trouvées pour des produits relevés (dernière recherche de chaque visite).
create table if not exists public.promos_circulaires (
  id uuid primary key default gen_random_uuid(),
  visite_id uuid references public.visites(id) on delete cascade,
  produit text not null, marque text, format text, cup text,
  mon_prix numeric not null, source_prix text,
  banniere text not null, offre text not null, prix numeric not null, prix_offre numeric,
  quantite int not null default 1, format_offre text, verdict text not null,
  ecart_pct numeric, par_unite text, fin timestamptz, trouve_le timestamptz not null default now()
);
create index if not exists promos_circulaires_visite on public.promos_circulaires (visite_id);
alter table public.promos_circulaires enable row level security;
create policy "promos avec jeton" on public.promos_circulaires for all to anon
  using ((select public.jeton_valide())) with check ((select public.jeton_ecriture()));
create policy "suppression complet seulement" on public.promos_circulaires as restrictive for delete to anon using ((select public.jeton_ecriture()));

-- Clé du service de recherche d'images (Serper, résultats de Google Images), lue par la fonction image.
-- Écrite une seule fois par le flux GitHub « Enregistrer la clé des images », puis l'accès d'écriture est retiré.
create or replace function public.lire_cle_images()
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then
    raise exception 'Acces refuse';
  end if;
  select decrypted_secret into r from vault.decrypted_secrets where name = 'serper_api_key' limit 1;
  return r;
end $$;
revoke execute on function public.lire_cle_images() from public, anon, authenticated;

-- Clé Google (Gemini) : le format accepté a été élargi (points permis, espaces retirés), puis l'accès d'écriture
-- a été retiré une fois la clé enregistrée.
revoke execute on function public.definir_cle_secours(text) from public, anon, authenticated;

-- Les réglages partagés (signature, circulaires, lecteur des photos, tarifs) ne se modifient qu'avec le code
-- principal : un collègue, même en accès complet, peut les lire mais pas les changer.
create or replace function public.jeton_proprietaire()
returns boolean language sql stable security definer set search_path = '' as $$
  select prive.est_proprietaire()
$$;
alter policy "reglages avec jeton" on public.reglages
  using ((select public.jeton_valide())) with check ((select public.jeton_proprietaire()));
alter policy "suppression complet seulement" on public.reglages using ((select public.jeton_proprietaire()));

-- ---------------------------------------------------------------------------------------------------------
-- Espaces privés : chaque téléphone qui entre avec le code collègue a son propre espace (visites, prix, listes,
-- promos, corbeille). Le code principal voit tout. Une ligne sans espace appartient au code principal.
create table if not exists prive.espaces (
  id uuid primary key default gen_random_uuid(),
  cle_hash text not null unique,
  numero int generated always as identity,
  cree_le timestamptz not null default now()
);
alter table prive.sessions add column if not exists espace_id uuid references prive.espaces(id);

create or replace function public.espace_courant()
returns uuid language sql stable security definer set search_path = '' as $$
  select espace_id from prive.sessions
  where jeton_hash = encode(sha256(convert_to(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-jeton', ''), 'UTF8')), 'hex')
$$;

alter table public.visites add column if not exists espace uuid;
alter table public.scans add column if not exists espace uuid;
alter table public.listes add column if not exists espace uuid;
alter table public.liste_produits add column if not exists espace uuid;
alter table public.promos_circulaires add column if not exists espace uuid;
alter table public.corbeille add column if not exists espace uuid;
alter table public.visites alter column espace set default public.espace_courant();
alter table public.scans alter column espace set default public.espace_courant();
alter table public.listes alter column espace set default public.espace_courant();
alter table public.liste_produits alter column espace set default public.espace_courant();
alter table public.promos_circulaires alter column espace set default public.espace_courant();
alter table public.corbeille alter column espace set default public.espace_courant();
create index if not exists visites_espace on public.visites (espace);
create index if not exists scans_espace on public.scans (espace);

-- Un prix suit toujours l'espace de sa visite, peu importe qui l'écrit (app, lecture de photo, assistant).
create or replace function prive.espace_du_scan()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.espace := (select v.espace from public.visites v where v.id = new.visite_id);
  return new;
end $$;
create or replace trigger scans_espace before insert or update on public.scans for each row execute function prive.espace_du_scan();

alter policy "visites sans compte" on public.visites
  using ((select public.jeton_valide()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())))
  with check ((select public.jeton_ecriture()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())));
alter policy "scans sans compte" on public.scans
  using ((select public.jeton_valide()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())))
  with check ((select public.jeton_ecriture()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())));
alter policy "listes avec jeton" on public.listes
  using ((select public.jeton_valide()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())))
  with check ((select public.jeton_ecriture()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())));
alter policy "liste avec jeton" on public.liste_produits
  using ((select public.jeton_valide()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())))
  with check ((select public.jeton_ecriture()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())));
alter policy "promos avec jeton" on public.promos_circulaires
  using ((select public.jeton_valide()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())))
  with check ((select public.jeton_ecriture()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())));
alter policy "corbeille en lecture" on public.corbeille
  using ((select public.jeton_valide()) and ((select public.jeton_proprietaire()) or espace = (select public.espace_courant())));

-- Les prix de référence restent visibles par tous, mais seul le code principal les importe ou les efface.
alter policy "reference avec jeton" on public.reference_prix
  using ((select public.jeton_valide())) with check ((select public.jeton_proprietaire()));
alter policy "suppression complet seulement" on public.reference_prix using ((select public.jeton_proprietaire()));

-- Ouverture de session : le téléphone d'un collègue envoie sa clé d'appareil, qui désigne son espace.
-- (Remplace les versions plus haut.)
create or replace function prive.ouvrir(code text, appareil text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h text; j text; r text; c boolean := false; k record; e uuid;
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
  if c and appareil is not null and length(appareil) between 32 and 128 and appareil ~ '^[A-Za-z0-9_-]+$' then
    insert into prive.espaces (cle_hash) values (encode(sha256(convert_to(appareil, 'UTF8')), 'hex'))
      on conflict (cle_hash) do update set cle_hash = excluded.cle_hash
      returning id into e;
  end if;
  j := encode(extensions.gen_random_bytes(32), 'hex');
  insert into prive.sessions (jeton_hash, role, collegue, espace_id) values (encode(sha256(convert_to(j, 'UTF8')), 'hex'), r, c, e);
  return jsonb_build_object('ok', true, 'jeton', j, 'role', r);
end $$;

create or replace function public.ouvrir_session(code text)
returns jsonb language sql security definer set search_path = '' as $$
  select prive.ouvrir(code, null)
$$;
create or replace function public.ouvrir_session_appareil(code text, appareil text)
returns jsonb language sql security definer set search_path = '' as $$
  select prive.ouvrir(code, appareil)
$$;

create or replace function public.etat_acces()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', public.jeton_role(),
    'proprietaire', prive.est_proprietaire(),
    'espace', public.espace_courant() is not null,
    'espaces', case when prive.est_proprietaire() then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero) order by numero), '[]'::jsonb) from prive.espaces) end,
    'collegue', case when prive.est_proprietaire() then (select jsonb_build_object('role', role, 'cree_le', cree_le) from prive.codes where id = 1) end
  )
$$;

-- Corbeille : la copie garde l'espace de l'élément supprimé ; chacun ne récupère et ne vide que la sienne.
create or replace function prive.vers_corbeille()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.corbeille (type, objet_id, donnees, espace) values (tg_table_name, old.id, to_jsonb(old), old.espace);
  return old;
end $$;

create or replace function public.restaurer(corbeille_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; n int := 0;
begin
  if not public.jeton_ecriture() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  select * into c from public.corbeille where id = corbeille_id;
  if not found or not coalesce(prive.est_proprietaire() or c.espace = public.espace_courant(), false) then
    return jsonb_build_object('ok', false, 'erreur', 'introuvable');
  end if;
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
  delete from public.corbeille where coalesce(prive.est_proprietaire() or espace = public.espace_courant(), false);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Liens d'invitation : « Partager l'application » crée un lien qui ouvre une session collègue (accès complet,
-- espace privé du téléphone) sans code à taper. Seul le hash du jeton est gardé. Valide 7 jours.
create table if not exists prive.invitations (
  id uuid primary key default gen_random_uuid(),
  jeton_hash text not null unique,
  cree_le timestamptz not null default now(),
  expire_le timestamptz not null default now() + interval '7 days'
);

create or replace function public.creer_invitation()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j text; x timestamptz;
begin
  if not prive.est_proprietaire() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  j := encode(extensions.gen_random_bytes(24), 'hex');
  insert into prive.invitations (jeton_hash) values (encode(sha256(convert_to(j, 'UTF8')), 'hex')) returning expire_le into x;
  return jsonb_build_object('ok', true, 'invitation', j, 'expire_le', x);
end $$;

create or replace function public.ouvrir_invitation(invitation text, appareil text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j text; e uuid;
begin
  if (select count(*) from prive.echecs where quand > now() - interval '15 minutes') >= 5 then
    return jsonb_build_object('ok', false, 'bloque', true);
  end if;
  if appareil is null or length(appareil) not between 32 and 128 or appareil !~ '^[A-Za-z0-9_-]+$' then
    return jsonb_build_object('ok', false, 'erreur', 'appareil');
  end if;
  if invitation is null or not exists (
    select 1 from prive.invitations where jeton_hash = encode(sha256(convert_to(invitation, 'UTF8')), 'hex') and expire_le > now()
  ) then
    insert into prive.echecs default values;
    return jsonb_build_object('ok', false, 'bloque', false);
  end if;
  insert into prive.espaces (cle_hash) values (encode(sha256(convert_to(appareil, 'UTF8')), 'hex'))
    on conflict (cle_hash) do update set cle_hash = excluded.cle_hash
    returning id into e;
  j := encode(extensions.gen_random_bytes(32), 'hex');
  insert into prive.sessions (jeton_hash, role, collegue, espace_id) values (encode(sha256(convert_to(j, 'UTF8')), 'hex'), 'complet', true, e);
  return jsonb_build_object('ok', true, 'jeton', j, 'role', 'complet');
end $$;

-- (Remplace la version plus haut.)
create or replace function public.etat_acces()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'role', public.jeton_role(),
    'proprietaire', prive.est_proprietaire(),
    'espace', public.espace_courant() is not null,
    'espaces', case when prive.est_proprietaire() then (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'numero', numero) order by numero), '[]'::jsonb) from prive.espaces) end,
    'invitations', case when prive.est_proprietaire() then (select count(*) from prive.invitations where expire_le > now()) end,
    'collegue', case when prive.est_proprietaire() then (select jsonb_build_object('role', role, 'cree_le', cree_le) from prive.codes where id = 1) end
  )
$$;

-- Retirer l'accès des collègues : le code, les liens d'invitation et toutes leurs sessions.
create or replace function public.retirer_code_collegue()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not prive.est_proprietaire() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  delete from prive.codes where id = 1;
  delete from prive.invitations where true;
  delete from prive.sessions where collegue;
  return jsonb_build_object('ok', true);
end $$;

-- Les liens d'invitation n'expirent pas : ils restent actifs jusqu'au retrait de l'accès des collègues.
alter table prive.invitations alter column expire_le set default 'infinity';
create or replace function public.creer_invitation()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare j text;
begin
  if not prive.est_proprietaire() then return jsonb_build_object('ok', false, 'erreur', 'acces'); end if;
  j := encode(extensions.gen_random_bytes(24), 'hex');
  insert into prive.invitations (jeton_hash) values (encode(sha256(convert_to(j, 'UTF8')), 'hex'));
  return jsonb_build_object('ok', true, 'invitation', j);
end $$;

-- Lien vers l'offre dans la circulaire en ligne (page Flipp de l'article).
alter table public.promos_circulaires add column if not exists lien text;
