-- =====================================================================
-- KASIR · Toko Teh Tjap Dua Koi
-- Skema POS: perangkat, katalog (menu, harga, metode bayar, diskon), audit.
--
-- Cara pakai: jalankan SETELAH kolam/setup.sql (fungsi kk_is_staff,
-- kk_is_owner, kk_owner_mfa dipakai di sini). Buka Supabase > SQL Editor >
-- New query, tempel SELURUH isi file ini, lalu Run. Aman dijalankan ulang.
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
-- Metode bawaan hanya saat daftar masih kosong (daftar milik pemilik tidak ditambahi lagi).
insert into public.pos_pay_methods(name, kind, sort)
select v.name, v.kind, v.sort from (values ('Tunai','tunai',1), ('QRIS','qris',2), ('Transfer bank','transfer',3))
  as v(name, kind, sort)
where not exists (select 1 from public.pos_pay_methods);

create table if not exists public.pos_discounts(
  id bigserial primary key,
  name text not null,
  kind text not null check (kind in ('persen','rupiah')),
  value int not null check (value >= 0),
  active boolean not null default true
);
alter table public.pos_discounts drop constraint if exists pos_discounts_persen_maks;
alter table public.pos_discounts add constraint pos_discounts_persen_maks check (kind <> 'persen' or value <= 100);

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

-- Shift kasir (tabel saja; aturan buka/tutup/serah terima menyusul).
-- Shift terbuka = closed_at kosong.
create table if not exists public.pos_shifts(
  id bigserial primary key,
  cashier uuid,
  device text,
  opened_at timestamptz default now(),
  cash_start int,
  received_from bigint,
  closed_at timestamptz,
  cash_counted int,
  close_photo text,
  received_count int,
  received_by uuid,
  received_at timestamptz
);

-- Nota lunas. Terkunci setelah dibuat: hanya status, voided_at, held yang boleh berubah (trigger di bawah).
create table if not exists public.pos_notas(
  id uuid primary key,                    -- dibuat HP (idempoten untuk kiriman ulang)
  no text not null unique,                -- K + yymmdd + '-' + urut harian (WITA)
  cashier uuid not null,
  device text not null,
  shift_id bigint not null references public.pos_shifts(id),
  client_at timestamptz not null,
  received_at timestamptz not null default now(),
  offline boolean not null default false,
  subtotal int not null,
  discount_id bigint references public.pos_discounts(id),
  discount_amt int not null default 0,
  total int not null check (total >= 0),  -- total yang tercatat di HP
  server_total int not null,              -- hitungan server dari harga yang berlaku
  price_mismatch boolean not null default false,
  method_id bigint not null references public.pos_pay_methods(id),
  cash_received int,
  change int,
  photo_path text not null unique,
  customer_phone text,
  voucher_code text,
  status text not null default 'lunas' check (status in ('lunas','batal')),
  voided_at timestamptz,
  held boolean not null default false
);
create index if not exists pos_notas_shift on public.pos_notas(shift_id);

create table if not exists public.pos_nota_lines(
  id bigserial primary key,
  nota_id uuid not null references public.pos_notas(id),
  variant_id bigint not null references public.pos_variants(id),
  item_name text not null,
  variant_name text not null,
  qty int not null check (qty > 0),
  price int not null check (price >= 0),
  free boolean not null default false
);
create index if not exists pos_nota_lines_nota on public.pos_nota_lines(nota_id);

-- Nomor urut nota per hari WITA.
create table if not exists public.pos_counters(
  day date primary key,
  seq int not null
);

-- ---------- Kunci tabel: RLS aktif, tanpa policy, tanpa hak untuk klien ----------
-- Berlaku untuk SEMUA tabel dan sequence pos_* (termasuk yang ditambah nanti).
do $$ declare t record; begin
  for t in select c.oid::regclass as rel, c.relkind from pg_class c
           where c.relnamespace = 'public'::regnamespace and c.relname like 'pos\_%' and c.relkind in ('r', 'S') loop
    if t.relkind = 'r' then
      execute format('alter table %s enable row level security', t.rel);
      execute format('revoke all on table %s from public, anon, authenticated', t.rel);
    else
      execute format('revoke all on sequence %s from public, anon, authenticated', t.rel);
    end if;
  end loop;
end $$;

-- ---------- Bukti (foto) ----------
insert into storage.buckets(id, name, public) values ('bukti', 'bukti', false)
on conflict (id) do update set public = false;

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
  if length(p_device) > 64 then raise exception 'Kode perangkat terlalu panjang'; end if;
  if length(coalesce(trim(p_label), '')) > 80 then raise exception 'Nama perangkat terlalu panjang'; end if;
  -- on conflict: dua permintaan bersamaan untuk HP yang sama tidak gagal
  insert into pos_devices(id, label, requested_by) values (p_device, coalesce(trim(p_label), ''), auth.uid())
  on conflict (id) do nothing;
  if found then
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

-- ---------- Nota terkunci ----------
create or replace function public.pos__nota_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' then raise exception 'Nota terkunci: tidak bisa dihapus'; end if;
  if (to_jsonb(new) - '{status,voided_at,held}'::text[]) is distinct from (to_jsonb(old) - '{status,voided_at,held}'::text[]) then
    raise exception 'Nota terkunci: hanya status yang boleh berubah';
  end if;
  -- status hanya lunas -> batal (sekali); voided_at hanya diisi sekali
  if new.status is distinct from old.status and not (old.status = 'lunas' and new.status = 'batal') then
    raise exception 'Nota terkunci: status hanya bisa lunas -> batal';
  end if;
  if new.voided_at is distinct from old.voided_at and old.voided_at is not null then
    raise exception 'Nota terkunci: waktu batal tidak bisa diubah';
  end if;
  return new;
end $$;
drop trigger if exists pos_nota_lock on public.pos_notas;
create trigger pos_nota_lock before update or delete on public.pos_notas
  for each row execute function public.pos__nota_lock();

create or replace function public.pos__nota_lines_lock() returns trigger
language plpgsql set search_path = public as $$
begin
  raise exception 'Nota terkunci: baris item tidak bisa diubah';
end $$;
drop trigger if exists pos_nota_lines_lock on public.pos_nota_lines;
create trigger pos_nota_lines_lock before update or delete on public.pos_nota_lines
  for each row execute function public.pos__nota_lines_lock();

-- Hasil checkout dari data tersimpan (dipakai juga untuk kiriman ulang, jadi hasilnya selalu sama).
create or replace function public.pos__nota_out(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', n.id, 'no', n.no, 'total', n.total, 'change', n.change,
    'pulls', case when r.nota is null then 0
                  else coalesce((select t.pulls from kk_tiers t where t.min_total <= r.total
                                  order by t.min_total desc limit 1), 0) end,
    'code_status', case when r.nota is null then 'tidak_ada' when r.held then 'ditahan' else 'aktif' end,
    'expires_at', r.expires_at)
  from pos_notas n left join kk_receipts r on r.pos_nota_id = n.id
  where n.id = p_id
$$;

-- ---------- Checkout ----------
-- p: {id, device, client_at, offline, lines:[{variant_id, qty}], discount_id, voucher_code,
--     method_id, total, cash_received, photo_path, customer_phone, code}
-- Satu transaksi: nota + baris + voucher + kk_receipts (kode klaim, hanya hash-nya).
create or replace function public.pos_checkout(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := now();
  v_id uuid;
  v_device text := p->>'device';
  v_offline boolean;
  v_client_at timestamptz;
  v_photo text := nullif(trim(p->>'photo_path'), '');
  v_voucher text := nullif(upper(trim(p->>'voucher_code')), '');
  v_total int;
  v_cashier uuid;
  v_dev pos_devices;
  v_held boolean := false;
  v_shift bigint;
  e record;
  v_var record;
  v_price int;
  v_lines jsonb := '[]'::jsonb;
  v_first jsonb;
  v_sub int;
  v_paid int;
  v_disc pos_discounts;
  v_disc_amt int := 0;
  v_server int;
  v_method pos_pay_methods;
  v_cash int;
  v_change int;
  v_phone text;
  v_code text;
  v_day date;
  v_seq int;
  v_no text;
  v_constraint text;
  v_kk_total int;
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  if coalesce(p->>'id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'ID nota tidak valid';
  end if;
  v_id := (p->>'id')::uuid;
  v_offline := coalesce((p->>'offline')::boolean, false);
  v_client_at := (p->>'client_at')::timestamptz;
  v_total := (p->>'total')::int;

  -- Idempoten: kiriman ulang (id sama, kasir sama) mengembalikan hasil yang sama tanpa perubahan.
  perform pg_advisory_xact_lock(hashtextextended('pos_checkout:' || v_id::text, 0));
  select cashier into v_cashier from pos_notas where id = v_id;
  if found then
    if v_cashier is distinct from v_uid then raise exception 'ID nota sudah dipakai'; end if;
    return pos__nota_out(v_id);
  end if;

  if v_client_at is null then raise exception 'Waktu nota kosong'; end if;
  if v_client_at > v_now + interval '5 minutes' then raise exception 'Jam HP tidak sesuai, periksa jam HP'; end if;
  if v_client_at < v_now - interval '3 days' then
    raise exception 'Nota lebih dari 3 hari, laporkan ke pemilik';
  end if;

  -- Perangkat: harus disetujui. Nota offline yang dibuat sebelum HP dicabut tetap diterima tapi ditahan.
  if pos__device_status(v_device) <> 'approved' then
    select * into v_dev from pos_devices where id = v_device;
    if v_offline and v_dev.approved_at is not null and v_dev.revoked_at is not null
       and v_client_at < v_dev.revoked_at then
      v_held := true;
    else
      raise exception 'Perangkat belum disetujui pemilik';
    end if;
  end if;

  select id into v_shift from pos_shifts where cashier = v_uid and closed_at is null
   order by opened_at desc, id desc limit 1;
  if v_shift is null then raise exception 'Buka shift dulu'; end if;

  -- Foto bukti: wajib, di folder kasir sendiri, sudah terunggah, belum dipakai nota lain.
  if v_photo is null then raise exception 'Foto bukti wajib'; end if;
  if not starts_with(v_photo, v_uid::text || '/')
     or not exists (select 1 from storage.objects o where o.bucket_id = 'bukti' and o.name = v_photo) then
    raise exception 'Foto bukti tidak ditemukan';
  end if;
  if exists (select 1 from pos_notas where photo_path = v_photo) then
    raise exception 'Foto bukti sudah dipakai nota lain';
  end if;

  -- Baris: harga dari server. Online = harga sekarang; offline = harga yang berlaku pada client_at.
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'Keranjang kosong';
  end if;
  for e in select (x->>'variant_id')::bigint as vid, (x->>'qty')::int as qty
             from jsonb_array_elements(p->'lines') with ordinality as t(x, i) order by i loop
    if e.qty is null or e.qty <= 0 or e.qty > 999 then raise exception 'Jumlah item tidak valid'; end if;
    select x.name as vname, x.price, x.active and i.active as active, i.name as iname into v_var
      from pos_variants x join pos_items i on i.id = x.item_id where x.id = e.vid;
    if not found then raise exception 'Menu tidak ada, muat ulang menu'; end if;
    if v_offline then
      select h.price into v_price from pos_price_history h
       where h.variant_id = e.vid and h.valid_from <= v_client_at order by h.valid_from desc limit 1;
      v_price := coalesce(v_price, v_var.price);
    else
      if not v_var.active then raise exception 'Menu sudah tidak dijual, muat ulang menu'; end if;
      v_price := v_var.price;
    end if;
    v_lines := v_lines || jsonb_build_object('variant_id', e.vid, 'item_name', v_var.iname,
      'variant_name', v_var.vname, 'qty', e.qty, 'price', v_price, 'free', false);
  end loop;

  -- Voucher TK-: online saja; satu porsi dari baris pertama menjadi gratis.
  if v_voucher is not null then
    if v_offline then raise exception 'Voucher tidak bisa dipakai saat offline'; end if;
    perform kk__use_voucher(v_voucher, v_uid);
    v_first := v_lines->0;
    if (v_first->>'qty')::int = 1 then
      v_lines := v_lines - 0;
    else
      v_lines := jsonb_set(v_lines, '{0,qty}', to_jsonb((v_first->>'qty')::int - 1));
    end if;
    v_lines := v_lines || (v_first || jsonb_build_object('qty', 1, 'price', 0, 'free', true));
  end if;

  select coalesce(sum(l.qty * l.price), 0), count(*) filter (where not l.free) into v_sub, v_paid
    from jsonb_to_recordset(v_lines) as l(qty int, price int, free boolean);

  if p->>'discount_id' is not null then
    select * into v_disc from pos_discounts
     where id = (p->>'discount_id')::bigint and (active or v_offline);
    if not found then raise exception 'Diskon tidak ada'; end if;
    v_disc_amt := case v_disc.kind when 'persen' then (v_sub::bigint * v_disc.value / 100)::int
                                   else least(v_disc.value, v_sub) end;
  end if;
  v_server := v_sub - v_disc_amt;

  if v_total is null or v_total < 0 then raise exception 'Total tidak valid'; end if;
  if v_total = 0 and v_paid > 0 then raise exception 'Total tidak boleh 0'; end if;
  if not v_offline and v_total <> v_server then raise exception 'Harga berubah, muat ulang menu'; end if;

  select * into v_method from pos_pay_methods where id = (p->>'method_id')::bigint and (active or v_offline);
  if not found then raise exception 'Metode bayar tidak ada'; end if;
  if v_method.kind = 'tunai' then
    v_cash := (p->>'cash_received')::int;
    if v_cash is null or v_cash < v_total then raise exception 'Uang diterima kurang dari total'; end if;
    v_change := v_cash - v_total;
  end if;

  -- Nomor HP pelanggan -> 62...
  v_phone := regexp_replace(coalesce(p->>'customer_phone', ''), '\D', '', 'g');
  if v_phone = '' then
    v_phone := null;
  else
    if v_phone like '0%' then v_phone := '62' || substr(v_phone, 2);
    elsif v_phone like '8%' then v_phone := '62' || v_phone; end if;
    if v_phone !~ '^62[0-9]{8,13}$' then raise exception 'Nomor HP pelanggan tidak valid'; end if;
  end if;

  -- Total untuk Kolam Koi: tidak pernah melebihi hitungan server (nota offline boleh beda,
  -- tapi tarikan kartu tidak ikut membesar). Total tersimpan di nota tetap uang yang diterima.
  v_kk_total := least(v_total, v_server);

  -- Kode klaim (dibuat HP): wajib bila ada total untuk Kolam Koi.
  if v_kk_total > 0 then
    v_code := upper(regexp_replace(coalesce(p->>'code', ''), '[\s-]', '', 'g'));
    if v_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$' then raise exception 'Kode klaim tidak valid'; end if;
  end if;

  v_day := (v_now at time zone 'Asia/Makassar')::date;
  insert into pos_counters(day, seq) values (v_day, 1)
  on conflict (day) do update set seq = pos_counters.seq + 1
  returning seq into v_seq;
  v_no := 'K' || to_char(v_day, 'YYMMDD') || '-' || case when v_seq < 1000 then lpad(v_seq::text, 3, '0') else v_seq::text end;

  insert into pos_notas(id, no, cashier, device, shift_id, client_at, received_at, offline, subtotal, discount_id,
    discount_amt, total, server_total, price_mismatch, method_id, cash_received, change, photo_path,
    customer_phone, voucher_code, held)
  values (v_id, v_no, v_uid, v_device, v_shift, v_client_at, v_now, v_offline, v_sub, v_disc.id,
    v_disc_amt, v_total, v_server, v_total <> v_server, v_method.id, v_cash, v_change, v_photo,
    v_phone, v_voucher, v_held);

  insert into pos_nota_lines(nota_id, variant_id, item_name, variant_name, qty, price, free)
  select v_id, (x->>'variant_id')::bigint, x->>'item_name', x->>'variant_name', (x->>'qty')::int,
         (x->>'price')::int, (x->>'free')::boolean
    from jsonb_array_elements(v_lines) with ordinality as t(x, i)
   order by t.i;

  if v_disc.id is not null then
    perform pos__audit('pos_notas', v_id::text, 'diskon', null,
      jsonb_build_object('no', v_no, 'discount_id', v_disc.id, 'name', v_disc.name, 'amount', v_disc_amt));
  end if;
  if v_voucher is not null then
    perform pos__audit('pos_notas', v_id::text, 'voucher', null, jsonb_build_object('no', v_no, 'code', v_voucher));
  end if;

  -- Semua gratis (total 0): tidak ada kode klaim.
  if v_kk_total > 0 then
    begin
      insert into kk_receipts(nota, total, created_by, code_hash, bound_phone, expires_at, pos_nota_id, held)
      values (v_no, v_kk_total, v_uid, encode(extensions.digest(v_code, 'sha256'), 'hex'), v_phone,
              v_now + case when v_phone is not null then interval '7 days' else interval '2 hours' end, v_id, v_held);
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint like '%code_hash%' then raise exception 'Kode bentrok, coba lagi'; end if;
      raise exception 'Nomor nota % sudah terdaftar di Kolam Koi', v_no;
    end;
  end if;

  return pos__nota_out(v_id);
end $$;

-- Nota shift terbuka milik kasir yang login (terbaru dulu).
create or replace function public.pos_my_notas() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'no', n.no, 'client_at', n.client_at,
             'received_at', n.received_at, 'total', n.total, 'method', m.name, 'status', n.status,
             'offline', n.offline, 'held', n.held,
             'has_void_request', false)  -- pengajuan void menyusul
           order by n.received_at desc, n.no desc)
      from pos_notas n
      join pos_shifts s on s.id = n.shift_id
      join pos_pay_methods m on m.id = n.method_id
     where n.cashier = auth.uid() and s.cashier = auth.uid() and s.closed_at is null), '[]'::jsonb);
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
-- Internal, sengaja tidak di-grant: pos__audit, pos__device_status, pos_device_ok, pos__nota_out,
-- pos__nota_lock, pos__nota_lines_lock.
grant execute on function public.pos_device_request(text, text), public.pos_devices_list(),
  public.pos_device_decide(text, boolean), public.pos_catalog(), public.pos_item_save(jsonb),
  public.pos_variant_save(jsonb), public.pos_method_save(jsonb), public.pos_discount_save(jsonb),
  public.pos_me(text), public.pos_checkout(jsonb), public.pos_my_notas()
  to authenticated;
