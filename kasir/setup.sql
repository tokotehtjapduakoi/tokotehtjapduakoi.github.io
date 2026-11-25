-- =====================================================================
-- KASIR · Toko Teh Tjap Dua Koi
-- Skema POS: perangkat, katalog (menu, harga, metode bayar, diskon), audit.
--
-- Cara pakai: jalankan SETELAH kolam/setup.sql (fungsi kk_is_staff,
-- kk_is_owner, kk_owner_mfa dipakai di sini). Buka Supabase > SQL Editor >
-- New query, tempel SELURUH isi file ini, lalu Run. Aman dijalankan ulang.
-- Kalau kolam/setup.sql dijalankan ulang, jalankan file ini lagi sesudahnya
-- (kolam mencabut hak fungsi semua fungsi di schema public).
--
-- Klien tidak membaca/menulis tabel pos_* langsung: semua lewat fungsi pos_*.
-- =====================================================================

-- ---------- Tabel ----------
create table if not exists public.pos_devices(
  id text primary key,
  label text not null default '',
  requested_by uuid,
  requested_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  revoked_at timestamptz
);

create table if not exists public.pos_items(
  id bigserial primary key,
  name text not null,
  category text not null default '',
  sort int not null default 0,
  active boolean not null default true
);

create table if not exists public.pos_variants(
  id bigserial primary key,
  item_id bigint not null references public.pos_items(id),
  name text not null,
  price int not null check (price >= 0),
  active boolean not null default true
);

create table if not exists public.pos_price_history(
  variant_id bigint not null references public.pos_variants(id),
  price int not null,
  valid_from timestamptz not null default now(),
  set_by uuid
);

create table if not exists public.pos_pay_methods(
  id bigserial primary key,
  name text not null unique,
  kind text not null check (kind in ('tunai','qris','transfer')),
  active boolean not null default true,
  sort int not null default 0
);
insert into public.pos_pay_methods(name, kind, sort) values
  ('Tunai','tunai',1), ('QRIS','qris',2), ('Transfer bank','transfer',3)
on conflict (name) do nothing;

create table if not exists public.pos_discounts(
  id bigserial primary key,
  name text not null,
  kind text not null check (kind in ('persen','rupiah')),
  value int not null check (value >= 0),
  active boolean not null default true
);

create table if not exists public.pos_audit(
  id bigserial primary key,
  tbl text not null,
  row_id text,
  action text not null,
  old jsonb,
  new jsonb,
  by_user uuid,
  at timestamptz not null default now(),
  source text not null default 'app'
);

-- ---------- Kunci tabel: RLS aktif, tanpa policy, tanpa hak untuk klien ----------
alter table public.pos_devices enable row level security;
alter table public.pos_items enable row level security;
alter table public.pos_variants enable row level security;
alter table public.pos_price_history enable row level security;
alter table public.pos_pay_methods enable row level security;
alter table public.pos_discounts enable row level security;
alter table public.pos_audit enable row level security;

revoke all on public.pos_devices, public.pos_items, public.pos_variants, public.pos_price_history,
  public.pos_pay_methods, public.pos_discounts, public.pos_audit from anon, authenticated;
revoke all on sequence public.pos_items_id_seq, public.pos_variants_id_seq,
  public.pos_pay_methods_id_seq, public.pos_discounts_id_seq, public.pos_audit_id_seq
  from anon, authenticated;

-- ---------- Bukti (foto) ----------
insert into storage.buckets(id, name, public) values ('bukti', 'bukti', false) on conflict (id) do nothing;

drop policy if exists pos_bukti_unggah on storage.objects;
create policy pos_bukti_unggah on storage.objects for insert to authenticated
  with check (bucket_id = 'bukti' and public.kk_is_staff() and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists pos_bukti_baca on storage.objects;
create policy pos_bukti_baca on storage.objects for select to authenticated
  using (bucket_id = 'bukti' and public.kk_is_staff());
-- Sengaja tidak ada policy update/delete.

-- ---------- Internal ----------
create or replace function public.pos__audit(p_tbl text, p_row text, p_action text, p_old jsonb, p_new jsonb)
returns void language sql security definer set search_path = public as $$
  insert into pos_audit(tbl, row_id, action, old, new, by_user)
  values (p_tbl, p_row, p_action, p_old, p_new, auth.uid())
$$;

create or replace function public.pos__device_status(p_device text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select case when revoked_at is not null then 'revoked'
                               when approved_at is not null then 'approved'
                               else 'pending' end
                     from pos_devices where id = p_device), 'unknown')
$$;

create or replace function public.pos_device_ok(p_device text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.pos__device_status(p_device) = 'approved'
$$;

-- ---------- Perangkat ----------
create or replace function public.pos_device_request(p_device text, p_label text) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  if coalesce(trim(p_device), '') = '' then raise exception 'Kode perangkat kosong'; end if;
  if not exists (select 1 from pos_devices where id = p_device) then
    insert into pos_devices(id, label, requested_by) values (p_device, coalesce(trim(p_label), ''), auth.uid());
    perform pos__audit('pos_devices', p_device, 'minta', null,
      (select to_jsonb(d) from pos_devices d where d.id = p_device));
  end if;
  return pos__device_status(p_device);
end $$;

create or replace function public.pos_devices_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not kk_owner_mfa() then raise exception 'Khusus pemilik'; end if;
  return coalesce((select jsonb_agg(to_jsonb(d) || jsonb_build_object('status', pos__device_status(d.id))
                                    order by d.requested_at desc) from pos_devices d), '[]'::jsonb);
end $$;

create or replace function public.pos_device_decide(p_device text, p_approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_old jsonb; v_new jsonb;
begin
  if not kk_owner_mfa() then raise exception 'Khusus pemilik'; end if;
  select to_jsonb(d) into v_old from pos_devices d where d.id = p_device;
  if v_old is null then raise exception 'Perangkat tidak ada'; end if;
  if p_approve then
    update pos_devices set approved_by = auth.uid(), approved_at = now(), revoked_at = null where id = p_device;
  else
    update pos_devices set revoked_at = now() where id = p_device;
  end if;
  select to_jsonb(d) into v_new from pos_devices d where d.id = p_device;
  perform pos__audit('pos_devices', p_device, case when p_approve then 'setujui' else 'cabut' end, v_old, v_new);
end $$;

-- ---------- Katalog ----------
create or replace function public.pos_catalog() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  v := jsonb_build_object(
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'category', i.category,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'price', x.price)
                                    order by x.id)
                               from pos_variants x where x.item_id = i.id and x.active), '[]'::jsonb))
        order by i.sort, i.id) from pos_items i where i.active), '[]'::jsonb),
    'methods', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name, 'kind', m.kind)
        order by m.sort, m.id) from pos_pay_methods m where m.active), '[]'::jsonb),
    'discounts', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name, 'kind', d.kind, 'value', d.value)
        order by d.id) from pos_discounts d where d.active), '[]'::jsonb));
  return v || jsonb_build_object('version', md5(v::text));
end $$;

-- ---------- Simpan (pemilik + 2 langkah). p.id null = baru; kolom yang tak disebut tidak diubah ----------
create or replace function public.pos_item_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_old jsonb; v_new jsonb;
begin
  if not kk_owner_mfa() then raise exception 'Khusus pemilik'; end if;
  if v_id is null then
    if coalesce(trim(p->>'name'), '') = '' then raise exception 'Nama menu wajib diisi'; end if;
    insert into pos_items(name, category, sort, active)
    values (trim(p->>'name'), coalesce(p->>'category', ''), coalesce((p->>'sort')::int, 0),
            coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    select to_jsonb(i) into v_old from pos_items i where i.id = v_id;
    if v_old is null then raise exception 'Menu tidak ada'; end if;
    update pos_items set name = coalesce(nullif(trim(p->>'name'), ''), name),
      category = coalesce(p->>'category', category), sort = coalesce((p->>'sort')::int, sort),
      active = coalesce((p->>'active')::boolean, active) where id = v_id;
  end if;
  select to_jsonb(i) into v_new from pos_items i where i.id = v_id;
  perform pos__audit('pos_items', v_id::text, case when v_old is null then 'tambah' else 'ubah' end, v_old, v_new);
  return v_id;
end $$;

create or replace function public.pos_variant_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_old jsonb; v_new jsonb; v_price int;
begin
  if not kk_owner_mfa() then raise exception 'Khusus pemilik'; end if;
  if v_id is null then
    if coalesce(trim(p->>'name'), '') = '' then raise exception 'Nama ukuran wajib diisi'; end if;
    if p->>'price' is null then raise exception 'Harga wajib diisi'; end if;
    insert into pos_variants(item_id, name, price, active)
    values ((p->>'item_id')::bigint, trim(p->>'name'), (p->>'price')::int, coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    select to_jsonb(x) into v_old from pos_variants x where x.id = v_id;
    if v_old is null then raise exception 'Ukuran tidak ada'; end if;
    update pos_variants set item_id = coalesce((p->>'item_id')::bigint, item_id),
      name = coalesce(nullif(trim(p->>'name'), ''), name), price = coalesce((p->>'price')::int, price),
      active = coalesce((p->>'active')::boolean, active) where id = v_id;
  end if;
  select to_jsonb(x) into v_new from pos_variants x where x.id = v_id;
  v_price := (v_new->>'price')::int;
  if v_old is null or (v_old->>'price')::int is distinct from v_price then
    insert into pos_price_history(variant_id, price, set_by) values (v_id, v_price, auth.uid());
  end if;
  perform pos__audit('pos_variants', v_id::text, case when v_old is null then 'tambah' else 'ubah' end, v_old, v_new);
  return v_id;
end $$;

create or replace function public.pos_method_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_old jsonb; v_new jsonb;
begin
  if not kk_owner_mfa() then raise exception 'Khusus pemilik'; end if;
  if v_id is null then
    if coalesce(trim(p->>'name'), '') = '' then raise exception 'Nama metode wajib diisi'; end if;
    insert into pos_pay_methods(name, kind, active, sort)
    values (trim(p->>'name'), p->>'kind', coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 0))
    returning id into v_id;
  else
    select to_jsonb(m) into v_old from pos_pay_methods m where m.id = v_id;
    if v_old is null then raise exception 'Metode tidak ada'; end if;
    update pos_pay_methods set name = coalesce(nullif(trim(p->>'name'), ''), name), kind = coalesce(p->>'kind', kind),
      active = coalesce((p->>'active')::boolean, active), sort = coalesce((p->>'sort')::int, sort) where id = v_id;
  end if;
  select to_jsonb(m) into v_new from pos_pay_methods m where m.id = v_id;
  perform pos__audit('pos_pay_methods', v_id::text, case when v_old is null then 'tambah' else 'ubah' end, v_old, v_new);
  return v_id;
end $$;

create or replace function public.pos_discount_save(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint := nullif(p->>'id', '')::bigint; v_old jsonb; v_new jsonb;
begin
  if not kk_owner_mfa() then raise exception 'Khusus pemilik'; end if;
  if v_id is null then
    if coalesce(trim(p->>'name'), '') = '' then raise exception 'Nama diskon wajib diisi'; end if;
    insert into pos_discounts(name, kind, value, active)
    values (trim(p->>'name'), p->>'kind', (p->>'value')::int, coalesce((p->>'active')::boolean, true))
    returning id into v_id;
  else
    select to_jsonb(d) into v_old from pos_discounts d where d.id = v_id;
    if v_old is null then raise exception 'Diskon tidak ada'; end if;
    update pos_discounts set name = coalesce(nullif(trim(p->>'name'), ''), name), kind = coalesce(p->>'kind', kind),
      value = coalesce((p->>'value')::int, value), active = coalesce((p->>'active')::boolean, active) where id = v_id;
  end if;
  select to_jsonb(d) into v_new from pos_discounts d where d.id = v_id;
  perform pos__audit('pos_discounts', v_id::text, case when v_old is null then 'tambah' else 'ubah' end, v_old, v_new);
  return v_id;
end $$;

-- ---------- Siapa saya ----------
create or replace function public.pos_me(p_device text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  return jsonb_build_object(
    'role', (select role from kk_staff where user_id = auth.uid()),
    'name', (select name from kk_staff where user_id = auth.uid()),
    'mfa', coalesce(auth.jwt()->>'aal', '') = 'aal2',
    'device', pos__device_status(p_device),
    'shift', null);  -- diisi di Task 5 (shift terbuka)
end $$;

-- ---------- Hak akses fungsi ----------
-- kolam/setup.sql sudah mencabut + memberi hak fungsi kk_*; di sini hanya fungsi pos_*
-- yang dicabut ulang (supaya hak kk_* tidak ikut terhapus), lalu diberi satu per satu.
do $$ declare f record; begin
  for f in select p.oid::regprocedure as sig from pg_proc p
           where p.pronamespace = 'public'::regnamespace and p.proname like 'pos\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
-- pos__audit, pos__device_status, pos_device_ok sengaja tidak di-grant (internal).
grant execute on function public.pos_device_request(text, text), public.pos_devices_list(),
  public.pos_device_decide(text, boolean), public.pos_catalog(), public.pos_item_save(jsonb),
  public.pos_variant_save(jsonb), public.pos_method_save(jsonb), public.pos_discount_save(jsonb),
  public.pos_me(text)
  to authenticated;
