-- Supabase tiruan: hanya bagian yang dipakai kolam/setup.sql dan kasir/setup.sql.
-- Role dibuat tanpa superuser/bypassrls supaya RLS benar-benar berlaku.
do $$ begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login;
  end if;
end $$;
do $$ begin
  if not exists (select from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant anon, authenticated, service_role to authenticator;

-- Kasus terburuk: Supabase lama memberi semua hak ke anon/authenticated secara
-- default. Ditiru di sini supaya uji menangkap revoke/policy yang kurang.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema extensions to anon, authenticated;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated;

create table if not exists auth.users(
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz
);

create or replace function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claims', true)::jsonb->>'sub', '')::uuid $$;

create or replace function auth.jwt() returns jsonb language sql stable as
$$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets(id text primary key, name text, public boolean);

create table if not exists storage.objects(
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  created_at timestamptz default now(),
  metadata jsonb
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[] language sql immutable as
$$ select (string_to_array(name, '/'))[1:greatest(cardinality(string_to_array(name, '/')) - 1, 0)] $$;

grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
