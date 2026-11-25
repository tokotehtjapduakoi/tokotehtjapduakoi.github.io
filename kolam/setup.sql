-- =====================================================================
-- KOLAM KOI · Toko Teh Tjap Dua Koi
-- Database untuk gacha kartu koi member (Supabase).
--
-- Cara pakai: buka project Supabase Kolam Koi > SQL Editor > New query,
-- tempel SELURUH isi file ini, lalu Run. Aman dijalankan ulang: tabel
-- tidak dihapus, fungsi diperbarui.
--
-- Semua undian, poin, dan penukaran dihitung DI SERVER (fungsi di bawah),
-- jadi pelanggan tidak bisa mengakali hasil tarikan dari HP-nya.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Aturan (boleh diubah pemilik lewat Table Editor) ----------
create table if not exists public.kk_cards(
  id text primary key,
  tier text not null check (tier in ('R','SR','UR')),
  name text not null,
  secret boolean not null default false
);
insert into public.kk_cards(id,tier,name,secret) values
 ('kohaku','R','Kohaku',false),('showa','R','Showa',false),('sanke','R','Sanke',false),
 ('asagi','R','Asagi',false),('ogon','R','Ogon',false),('tancho','R','Tancho',false),
 ('api','SR','Koi Api',false),('listrik','SR','Koi Listrik',false),('air','SR','Koi Air',false),
 ('batu','SR','Koi Batu',false),('bulan','UR','Koi Bulan',false),('matahari','UR','Koi Matahari',false),
 ('tjap','UR','Koi Tjap (rahasia)',true)
on conflict (id) do nothing;

-- Belanja minimal -> jumlah tarikan
create table if not exists public.kk_tiers(min_total integer primary key, pulls integer not null check (pulls > 0));
insert into public.kk_tiers values (20000,1),(45000,2),(60000,3),(80000,4),(100000,5) on conflict do nothing;

-- Hadiah: poin -> hadiah
create table if not exists public.kk_rewards(points integer primary key, name text not null, detail text not null default '');
insert into public.kk_rewards values
 (12,'Upgrade jumbo 22 oz','Untuk 1 minuman'),
 (30,'1 minuman 14 oz gratis','Teh Tarik, Milo, Matcha atau Houjicha Tarik'),
 (60,'Paket Teman Tarik','2 minuman 14 oz + 1 bagel/wrap'),
 (120,'2 minuman jumbo + merchandise','Stiker atau gantungan koi'),
 (300,'Hadiah Koi Emas','Tumbler Tjap Dua Koi + 1 minuman gratis tiap bulan selama 3 bulan + nama di Kolam Kehormatan')
on conflict do nothing;

-- Skin kolam yang dibeli dengan poin
create table if not exists public.kk_skins(id text primary key, name text not null, cost integer not null check (cost > 0));
insert into public.kk_skins values ('hujan','Kolam Hujan Samarinda',30),('bintang','Kolam Malam Berbintang',60) on conflict do nothing;

-- ---------- Orang ----------
create table if not exists public.kk_staff(
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('pemilik','kasir')),
  name text not null default ''
);

create table if not exists public.kk_members(
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone text not null unique,
  nickname text not null,
  show_on_board boolean not null default true,
  pity_sr integer not null default 0,
  pity_ur integer not null default 0,
  bank integer not null default 0,
  trx integer not null default 0,
  spent bigint not null default 0,
  fails integer not null default 0,
  fail_day date,
  created_at timestamptz not null default now()
);

-- ---------- Transaksi ----------
create table if not exists public.kk_receipts(
  nota text primary key,
  total integer not null check (total > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  claimed_by uuid references public.kk_members(user_id) on delete set null,
  claimed_at timestamptz
);

create table if not exists public.kk_inventory(
  member_id uuid not null references public.kk_members(user_id) on delete cascade,
  card_id text not null references public.kk_cards(id),
  qty integer not null default 0 check (qty >= 0),
  primary key (member_id, card_id)
);

create table if not exists public.kk_collection(
  member_id uuid not null references public.kk_members(user_id) on delete cascade,
  card_id text not null references public.kk_cards(id),
  first_at timestamptz not null default now(),
  primary key (member_id, card_id)
);

create table if not exists public.kk_pulls(
  id bigserial primary key,
  member_id uuid not null references public.kk_members(user_id) on delete cascade,
  nota text not null,
  card_id text not null references public.kk_cards(id),
  tier text not null,
  created_at timestamptz not null default now()
);
create index if not exists kk_pulls_member_time on public.kk_pulls(member_id, created_at);

create table if not exists public.kk_exchanges(
  id bigserial primary key,
  member_id uuid not null references public.kk_members(user_id) on delete cascade,
  kind text not null check (kind in ('hadiah','skin')),
  item text not null,
  points integer not null,
  cards jsonb not null default '{}'::jsonb,
  code text unique,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);
create index if not exists kk_exchanges_time on public.kk_exchanges(created_at);

-- ---------- Ajak Teman (kode referensi) & bonus posting ----------
-- Angka program boleh diubah pemilik lewat Table Editor > kk_program.
create table if not exists public.kk_program(key text primary key, value integer not null, note text not null default '');
insert into public.kk_program values
 ('ajak_min_belanja',20000,'Belanja minimal (Rp) teman baru supaya kode ajak berlaku'),
 ('ajak_maks_per_bulan',15,'Maksimal teman per bulan yang memberi es teh gratis ke pengajak'),
 ('posting_per_hari',1,'Berapa kali bonus posting boleh diklaim satu member per hari'),
 ('posting_min_belanja',20000,'Bonus posting hanya jika member sudah memasukkan nota hari ini dengan total minimal ini (Rp)')
on conflict (key) do nothing;

alter table public.kk_members add column if not exists ref_code text unique;
alter table public.kk_members add column if not exists referred_by uuid references public.kk_members(user_id) on delete set null;
alter table public.kk_members add column if not exists ref_done_at timestamptz;      -- kapan teman ini memenuhi syarat
alter table public.kk_members add column if not exists ref_paid boolean not null default false; -- pengajak dapat hadiah?
alter table public.kk_members add column if not exists bonus_pulls integer not null default 0;
create index if not exists kk_members_referred on public.kk_members(referred_by, ref_done_at);

-- 'bonus' = voucher dari program (ajak teman / posting), bukan hasil tukar poin
alter table public.kk_exchanges drop constraint if exists kk_exchanges_kind_check;
alter table public.kk_exchanges add constraint kk_exchanges_kind_check check (kind in ('hadiah','skin','bonus'));

create table if not exists public.kk_posts(
  id bigserial primary key,
  member_id uuid not null references public.kk_members(user_id) on delete cascade,
  day date not null default ((now() at time zone 'Asia/Makassar')::date),
  choice text not null check (choice in ('esteh','tarik')),
  link text not null default '',
  staff_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists kk_posts_member_day on public.kk_posts(member_id, day);

-- ---------- Keamanan baris ----------
alter table public.kk_cards enable row level security;
alter table public.kk_tiers enable row level security;
alter table public.kk_rewards enable row level security;
alter table public.kk_skins enable row level security;
alter table public.kk_staff enable row level security;
alter table public.kk_members enable row level security;
alter table public.kk_receipts enable row level security;
alter table public.kk_inventory enable row level security;
alter table public.kk_collection enable row level security;
alter table public.kk_pulls enable row level security;
alter table public.kk_exchanges enable row level security;
alter table public.kk_program enable row level security;
alter table public.kk_posts enable row level security;

create or replace function public.kk_is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from kk_staff where user_id = auth.uid()) $$;

create or replace function public.kk_is_owner() returns boolean
language sql stable security definer set search_path = public as
$$ select exists(select 1 from kk_staff where user_id = auth.uid() and role = 'pemilik') $$;

do $$
declare t text;
begin
  -- aturan boleh dibaca siapa saja
  foreach t in array array['kk_cards','kk_tiers','kk_rewards','kk_skins','kk_program'] loop
    execute format('drop policy if exists baca on public.%I', t);
    execute format('create policy baca on public.%I for select using (true)', t);
  end loop;
  -- data pribadi: pemilik baris atau staf
  foreach t in array array['kk_inventory','kk_collection','kk_pulls','kk_exchanges','kk_posts'] loop
    execute format('drop policy if exists baca on public.%I', t);
    execute format('create policy baca on public.%I for select using (member_id = auth.uid() or public.kk_is_staff())', t);
  end loop;
end $$;
drop policy if exists baca on public.kk_members;
create policy baca on public.kk_members for select using (user_id = auth.uid() or public.kk_is_staff());
drop policy if exists baca on public.kk_receipts;
create policy baca on public.kk_receipts for select using (public.kk_is_staff());
drop policy if exists baca on public.kk_staff;
create policy baca on public.kk_staff for select using (user_id = auth.uid() or public.kk_is_owner());
-- Tidak ada policy insert/update/delete: semua perubahan lewat fungsi di bawah.

-- ---------- Pembantu program ----------
create or replace function public.kk_prog(p_key text, p_default integer) returns integer
language sql stable security definer set search_path = public as
$$ select coalesce((select value from kk_program where key = p_key), p_default) $$;

-- Kode voucher acak TK-XXXXX (tanpa huruf/angka yang mirip)
create or replace function public.kk_voucher_code() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare v text;
begin
  loop
    v := 'TK-' || upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1IL', ''), 1, 5));
    exit when length(v) = 8 and not exists (select 1 from kk_exchanges x where x.code = v);
  end loop;
  return v;
end $$;

-- Kode ajak: 3-6 huruf dari nama panggilan + 3 karakter acak, mis. RINA-7KQ
create or replace function public.kk_new_ref_code(p_nick text) returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare base text; c text;
begin
  base := upper(left(regexp_replace(coalesce(p_nick, ''), '[^A-Za-z]', '', 'g'), 6));
  if length(base) < 3 then base := 'KOI'; end if;
  loop
    c := base || '-' || upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1IL', ''), 1, 3));
    exit when length(c) = length(base) + 4 and not exists (select 1 from kk_members where ref_code = c);
  end loop;
  return c;
end $$;

-- Beri voucher program (tidak memakai poin)
create or replace function public.kk_give_bonus(p_member uuid, p_item text) returns text
language plpgsql security definer set search_path = public as $$
declare v text := kk_voucher_code();
begin
  insert into kk_exchanges(member_id, kind, item, points, cards, code) values (p_member, 'bonus', p_item, 0, '{}'::jsonb, v);
  return v;
end $$;

-- Undian kartu (dipakai tarikan nota & tarikan bonus)
create or replace function public.kk_do_pulls(p_member uuid, p_n integer, p_nota text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m kk_members; t text; x float8; c text; cards text[] := '{}'; v_secret boolean := false;
begin
  select * into m from kk_members where user_id = p_member for update;
  for i in 1..p_n loop
    m.pity_sr := m.pity_sr + 1; m.pity_ur := m.pity_ur + 1;
    if m.pity_ur >= 40 then t := 'UR';
    elsif m.pity_sr >= 10 then t := case when random() < 0.03 / 0.20 then 'UR' else 'SR' end;
    else x := random(); t := case when x < 0.03 then 'UR' when x < 0.20 then 'SR' else 'R' end;
    end if;
    if t <> 'R' then m.pity_sr := 0; end if;
    if t = 'UR' then m.pity_ur := 0; end if;
    select id into c from kk_cards d2 where d2.tier = t and not d2.secret order by random() limit 1;
    cards := cards || c;
    insert into kk_pulls(member_id, nota, card_id, tier) values (m.user_id, p_nota, c, t);
    insert into kk_inventory(member_id, card_id, qty) values (m.user_id, c, 1)
      on conflict (member_id, card_id) do update set qty = kk_inventory.qty + 1;
    insert into kk_collection(member_id, card_id) values (m.user_id, c) on conflict do nothing;
  end loop;

  -- kartu rahasia: terbuka saat ke-12 koi biasa pernah dimiliki
  if (select count(*) from kk_collection k join kk_cards d on d.id = k.card_id where k.member_id = m.user_id and not d.secret)
       = (select count(*) from kk_cards d2 where not d2.secret)
     and not exists (select 1 from kk_collection k join kk_cards d on d.id = k.card_id where k.member_id = m.user_id and d.secret) then
    for c in select d2.id from kk_cards d2 where d2.secret loop
      insert into kk_inventory(member_id, card_id, qty) values (m.user_id, c, 1)
        on conflict (member_id, card_id) do update set qty = kk_inventory.qty + 1;
      insert into kk_collection(member_id, card_id) values (m.user_id, c) on conflict do nothing;
      v_secret := true;
    end loop;
  end if;
  update kk_members set pity_sr = m.pity_sr, pity_ur = m.pity_ur where user_id = m.user_id;
  return jsonb_build_object('cards', to_jsonb(cards), 'secret', v_secret);
end $$;

-- ---------- Member baru otomatis dibuat saat daftar ----------
-- Akun member memakai email buatan: <nomorHP>@member.tjapduakoi.id
create or replace function public.kk_on_signup() returns trigger
language plpgsql security definer set search_path = public as $$
declare ph text; nick text; v_ref text; v_by uuid;
begin
  if new.email like '%@member.tjapduakoi.id' then
    ph := split_part(new.email, '@', 1);
    if ph !~ '^62[0-9]{8,13}$' then raise exception 'Nomor HP tidak valid'; end if;
    nick := left(coalesce(nullif(trim(new.raw_user_meta_data->>'nickname'), ''), 'Teman Koi'), 24);
    v_ref := upper(trim(coalesce(new.raw_user_meta_data->>'ref', '')));
    if v_ref <> '' then select user_id into v_by from kk_members where ref_code = v_ref; end if;
    insert into kk_members(user_id, phone, nickname, ref_code, referred_by) values (new.id, ph, nick, kk_new_ref_code(nick), v_by);
  end if;
  return new;
end $$;
drop trigger if exists kk_on_signup on auth.users;
create trigger kk_on_signup after insert on auth.users for each row execute function public.kk_on_signup();

-- ---------- Data milik member ----------
create or replace function public.kk_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m kk_members; mon timestamptz := date_trunc('month', now() at time zone 'Asia/Makassar') at time zone 'Asia/Makassar';
begin
  select * into m from kk_members where user_id = auth.uid();
  if not found then return null; end if;
  return jsonb_build_object(
    'nickname', m.nickname, 'phone', m.phone, 'show_on_board', m.show_on_board,
    'pity_sr', m.pity_sr, 'pity_ur', m.pity_ur, 'bank', m.bank, 'trx', m.trx, 'spent', m.spent,
    'inv', coalesce((select jsonb_object_agg(card_id, qty) from kk_inventory where member_id = m.user_id and qty > 0), '{}'::jsonb),
    'ever', coalesce((select jsonb_agg(card_id) from kk_collection where member_id = m.user_id), '[]'::jsonb),
    'exchanged', coalesce((select sum(points) from kk_exchanges where member_id = m.user_id), 0),
    'ex_month', coalesce((select sum(points) from kk_exchanges where member_id = m.user_id and created_at >= mon), 0),
    'skins', coalesce((select jsonb_agg(item) from kk_exchanges where member_id = m.user_id and kind = 'skin'), '[]'::jsonb),
    'vouchers', coalesce((select jsonb_agg(jsonb_build_object('nm', item, 'code', code, 'at', created_at, 'used_at', used_at) order by created_at desc)
                 from kk_exchanges where member_id = m.user_id and kind in ('hadiah','bonus')), '[]'::jsonb),
    'ref_code', m.ref_code,
    'ref_month', (select count(*) from kk_members f where f.referred_by = m.user_id and f.ref_paid and f.ref_done_at >= mon),
    'ref_total', (select count(*) from kk_members f where f.referred_by = m.user_id and f.ref_done_at is not null),
    'ref_pending', (select count(*) from kk_members f where f.referred_by = m.user_id and f.ref_done_at is null),
    'ref_max', kk_prog('ajak_maks_per_bulan', 15),
    'ref_min', kk_prog('ajak_min_belanja', 20000),
    'referred_by', (select r.nickname from kk_members r where r.user_id = m.referred_by),
    'ref_done', m.ref_done_at is not null,
    'can_use_ref', m.referred_by is null and m.trx = 0,
    'bonus_pulls', m.bonus_pulls,
    'post_today', (select count(*) from kk_posts p where p.member_id = m.user_id and p.day = (now() at time zone 'Asia/Makassar')::date),
    'post_min', kk_prog('posting_min_belanja', 20000)
  );
end $$;

create or replace function public.kk_update_profile(p_nickname text, p_show boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(trim(p_nickname), '') = '' then raise exception 'Nama panggilan tidak boleh kosong'; end if;
  update kk_members set nickname = left(trim(p_nickname), 24), show_on_board = coalesce(p_show, true) where user_id = auth.uid();
end $$;

-- ---------- Tarik kartu dari nota ----------
create or replace function public.kk_claim(p_nota text, p_total integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m kk_members; r kk_receipts; n integer; res jsonb; v_nota text := upper(trim(p_nota));
  v_ajak jsonb := null; v_code text; v_by kk_members; v_cnt integer;
  mon timestamptz := date_trunc('month', now() at time zone 'Asia/Makassar') at time zone 'Asia/Makassar';
begin
  select * into m from kk_members where user_id = auth.uid() for update;
  if not found then raise exception 'Masuk sebagai member dulu'; end if;
  if m.fail_day is distinct from current_date then m.fails := 0; end if;
  if m.fails >= 10 then
    return jsonb_build_object('status', 'blocked');
  end if;
  if v_nota = '' or p_total is null then return jsonb_build_object('status', 'not_found'); end if;

  select * into r from kk_receipts where kk_receipts.nota = v_nota for update;
  if not found or r.total <> p_total then
    update kk_members set fails = m.fails + 1, fail_day = current_date where user_id = m.user_id;
    return jsonb_build_object('status', 'not_found', 'left', 9 - m.fails);
  end if;
  if r.claimed_by is not null then
    return jsonb_build_object('status', 'used', 'mine', r.claimed_by = m.user_id);
  end if;

  select pulls into n from kk_tiers where min_total <= r.total order by min_total desc limit 1;
  update kk_receipts set claimed_by = m.user_id, claimed_at = now() where kk_receipts.nota = r.nota;
  update kk_members set trx = trx + 1, spent = spent + r.total, fails = 0, fail_day = current_date where user_id = m.user_id;

  -- Ajak Teman: belanja pertama yang memenuhi syarat -> teman & pengajak dapat es teh
  if m.referred_by is not null and m.ref_done_at is null and r.total >= kk_prog('ajak_min_belanja', 20000) then
    v_code := kk_give_bonus(m.user_id, 'Es teh gratis · hadiah teman baru');
    select * into v_by from kk_members where user_id = m.referred_by for update;
    select count(*) into v_cnt from kk_members f where f.referred_by = v_by.user_id and f.ref_paid and f.ref_done_at >= mon;
    if v_cnt < kk_prog('ajak_maks_per_bulan', 15) then
      perform kk_give_bonus(v_by.user_id, 'Es teh gratis · ajak ' || m.nickname);
      update kk_members set ref_done_at = now(), ref_paid = true where user_id = m.user_id;
    else
      update kk_members set ref_done_at = now(), ref_paid = false where user_id = m.user_id;
    end if;
    v_ajak := jsonb_build_object('code', v_code, 'oleh', v_by.nickname);
  end if;

  if n is null then
    return jsonb_build_object('status', 'too_small', 'total', r.total, 'ajak', v_ajak);
  end if;
  res := kk_do_pulls(m.user_id, n, r.nota);
  return jsonb_build_object('status', 'ok', 'total', r.total, 'pulls', n, 'cards', res->'cards', 'secret', (res->>'secret')::boolean, 'ajak', v_ajak);
end $$;

-- ---------- Ajak Teman: fungsi member ----------
-- Cek kode sebelum daftar (boleh tanpa login). Mengembalikan nama panggilan pemilik kode.
create or replace function public.kk_ref_check(p_code text) returns text
language sql stable security definer set search_path = public as
$$ select nickname from kk_members where ref_code = upper(trim(p_code)) $$;

-- Pasang kode teman setelah daftar (hanya sebelum transaksi pertama)
create or replace function public.kk_use_ref(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare m kk_members; v_by kk_members;
begin
  select * into m from kk_members where user_id = auth.uid() for update;
  if not found then raise exception 'Masuk sebagai member dulu'; end if;
  if m.referred_by is not null then raise exception 'Kamu sudah memakai kode teman'; end if;
  if m.trx > 0 then raise exception 'Kode teman hanya untuk member baru sebelum belanja pertama'; end if;
  select * into v_by from kk_members where ref_code = upper(trim(p_code));
  if not found then raise exception 'Kode tidak ditemukan. Periksa lagi hurufnya'; end if;
  if v_by.user_id = m.user_id then raise exception 'Tidak bisa memakai kode sendiri'; end if;
  if v_by.referred_by = m.user_id then raise exception 'Kalian tidak bisa saling memakai kode'; end if;
  update kk_members set referred_by = v_by.user_id where user_id = m.user_id;
  return v_by.nickname;
end $$;

-- Tarikan bonus (dari bonus posting)
create or replace function public.kk_pull_bonus() returns jsonb
language plpgsql security definer set search_path = public as $$
declare m kk_members; res jsonb;
begin
  select * into m from kk_members where user_id = auth.uid() for update;
  if not found then raise exception 'Masuk sebagai member dulu'; end if;
  if m.bonus_pulls < 1 then raise exception 'Tidak ada tarikan bonus'; end if;
  update kk_members set bonus_pulls = bonus_pulls - 1 where user_id = m.user_id;
  res := kk_do_pulls(m.user_id, 1, 'BONUS-POSTING');
  return jsonb_build_object('status', 'ok', 'pulls', 1, 'cards', res->'cards', 'secret', (res->>'secret')::boolean);
end $$;

-- ---------- Tukar kartu ----------
-- p_cards: {"kohaku":3,"api":1}. p_skin: id skin (kosongkan untuk tukar hadiah).
create or replace function public.kk_exchange(p_cards jsonb, p_skin text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  m kk_members; k text; q integer; have integer; pts integer; v_cost integer; v_item text; v_code text; e record;
  pt jsonb := '{"R":1,"SR":5,"UR":25}';
begin
  select * into m from kk_members where user_id = auth.uid() for update;
  if not found then raise exception 'Masuk sebagai member dulu'; end if;
  pts := m.bank;
  for k, q in select key, (value)::int from jsonb_each_text(coalesce(p_cards, '{}'::jsonb)) loop
    if q < 0 then raise exception 'Jumlah kartu tidak valid'; end if;
    if q = 0 then continue; end if;
    select i.qty into have from kk_inventory i where i.member_id = m.user_id and i.card_id = k for update;
    if coalesce(have, 0) < q then raise exception 'Kartu % tidak cukup', k; end if;
    pts := pts + q * (pt->>(select tier from kk_cards where id = k))::int;
  end loop;

  if p_skin is not null then
    select s.name, s.cost into v_item, v_cost from kk_skins s where s.id = p_skin;
    if not found then raise exception 'Skin tidak ada'; end if;
    if exists (select 1 from kk_exchanges where member_id = m.user_id and kind = 'skin' and kk_exchanges.item = p_skin) then
      raise exception 'Skin ini sudah kamu miliki';
    end if;
    v_item := p_skin;
  else
    select r.points, r.name into v_cost, v_item from kk_rewards r where r.points <= pts order by r.points desc limit 1;
  end if;
  if v_cost is null or pts < v_cost then raise exception 'Poin belum cukup'; end if;

  for k, q in select key, (value)::int from jsonb_each_text(coalesce(p_cards, '{}'::jsonb)) loop
    if q > 0 then update kk_inventory set qty = qty - q where member_id = m.user_id and card_id = k; end if;
  end loop;
  update kk_members set bank = pts - v_cost where user_id = m.user_id;

  if p_skin is null then
    loop
      v_code := 'TK-' || upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1IL', ''), 1, 5));
      exit when length(v_code) = 8 and not exists (select 1 from kk_exchanges x where x.code = v_code);
    end loop;
  end if;
  insert into kk_exchanges(member_id, kind, item, points, cards, code)
    values (m.user_id, case when p_skin is null then 'hadiah' else 'skin' end, v_item, v_cost, coalesce(p_cards, '{}'::jsonb), v_code)
    returning * into e;
  return jsonb_build_object('item', v_item, 'points', v_cost, 'code', v_code, 'bank', pts - v_cost);
end $$;

-- ---------- Kolam Kehormatan (papan peringkat bulanan, waktu WITA) ----------
create or replace function public.kk_board(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  d date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Makassar')::date));
  a timestamptz := d::timestamp at time zone 'Asia/Makassar';
  b timestamptz := (d + interval '1 month')::timestamp at time zone 'Asia/Makassar';
  total_cards integer := (select count(*) from kk_cards where not secret);
  me uuid := auth.uid();
begin
  return jsonb_build_object(
    'month', d,
    'tukar', coalesce((
      select jsonb_agg(row_to_json(x) order by x.v desc) from (
        select case when m.show_on_board or m.user_id = me then m.nickname else 'Teman Koi' end n,
               sum(e.points)::int v, m.user_id = me me
          from kk_exchanges e join kk_members m on m.user_id = e.member_id
         where e.created_at >= a and e.created_at < b and e.kind <> 'bonus'
         group by m.user_id order by v desc limit 20) x), '[]'::jsonb),
    'koleksi', coalesce((
      select jsonb_agg(row_to_json(y) order by y.t nulls last, y.v desc) from (
        select case when m.show_on_board or m.user_id = me then m.nickname else 'Teman Koi' end n,
               count(*)::int v,
               case when count(*) >= total_cards then max(f.first_at) end t,
               m.user_id = me me
          from (select p.member_id, p.card_id, min(p.created_at) first_at
                  from kk_pulls p join kk_cards c on c.id = p.card_id
                 where not c.secret and p.created_at >= a and p.created_at < b
                 group by p.member_id, p.card_id) f
          join kk_members m on m.user_id = f.member_id
         group by m.user_id
         order by case when count(*) >= total_cards then max(f.first_at) end nulls last, count(*) desc
         limit 20) y), '[]'::jsonb),
    'total_cards', total_cards
  );
end $$;

-- ---------- Fungsi kasir & pemilik ----------
create or replace function public.kk_add_receipt(p_nota text, p_total integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  if coalesce(trim(p_nota), '') = '' then raise exception 'Isi nomor nota'; end if;
  if coalesce(p_total, 0) <= 0 then raise exception 'Isi total belanja'; end if;
  insert into kk_receipts(nota, total, created_by) values (upper(trim(p_nota)), p_total, auth.uid());
exception when unique_violation then
  raise exception 'Nota % sudah terdaftar', upper(trim(p_nota));
end $$;

-- p_rows: [{"nota":"POS-1","total":45000}, ...]. Nota yang sudah ada dilewati.
create or replace function public.kk_add_receipts(p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  with ins as (
    insert into kk_receipts(nota, total, created_by)
    select upper(trim(r->>'nota')), (r->>'total')::int, auth.uid()
      from jsonb_array_elements(p_rows) r
     where coalesce(trim(r->>'nota'), '') <> '' and (r->>'total')::int > 0
    on conflict (nota) do nothing returning 1)
  select count(*) into n from ins;
  return n;
end $$;

create or replace function public.kk_delete_receipt(p_nota text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  delete from kk_receipts where nota = upper(trim(p_nota)) and claimed_by is null;
  if not found then raise exception 'Nota tidak ada atau sudah diklaim'; end if;
end $$;

create or replace function public.kk_check_voucher(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v record;
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  select e.code, e.item, e.points, e.created_at, e.used_at, m.nickname, m.phone into v
    from kk_exchanges e join kk_members m on m.user_id = e.member_id
   where e.code = upper(trim(p_code)) and e.kind in ('hadiah','bonus');
  if not found then return null; end if;
  return to_jsonb(v);
end $$;

create or replace function public.kk_use_voucher(p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  update kk_exchanges set used_at = now(), used_by = auth.uid()
   where code = upper(trim(p_code)) and kind in ('hadiah','bonus') and used_at is null;
  if not found then raise exception 'Voucher tidak ada atau sudah dipakai'; end if;
end $$;

-- Bonus posting: kasir sudah melihat post/story yang men-tag @tokoteh.tjapduakoi.
-- p_choice: 'esteh' (voucher es teh gratis) atau 'tarik' (+1 tarikan kartu).
-- Status bonus posting satu member hari ini (untuk layar kasir)
create or replace function public.kk_posting_status(p_phone text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m kk_members; v_day date := (now() at time zone 'Asia/Makassar')::date;
  v_mulai timestamptz := date_trunc('day', now() at time zone 'Asia/Makassar') at time zone 'Asia/Makassar';
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  select * into m from kk_members where phone = p_phone;
  if not found then return null; end if;
  return jsonb_build_object('nickname', m.nickname, 'phone', m.phone,
    'today', (select count(*) from kk_posts where member_id = m.user_id and day = v_day) >= kk_prog('posting_per_hari', 1),
    'belanja', coalesce((select max(total) from kk_receipts r where r.claimed_by = m.user_id and r.claimed_at >= v_mulai), 0),
    'min', kk_prog('posting_min_belanja', 20000));
end $$;

create or replace function public.kk_posting_bonus(p_phone text, p_choice text, p_link text default '') returns jsonb
language plpgsql security definer set search_path = public as $$
declare m kk_members; v_code text; v_day date := (now() at time zone 'Asia/Makassar')::date; v_n integer;
  v_mulai timestamptz := date_trunc('day', now() at time zone 'Asia/Makassar') at time zone 'Asia/Makassar';
  v_min integer := kk_prog('posting_min_belanja', 20000);
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  if p_choice not in ('esteh','tarik') then raise exception 'Pilih es teh atau tarikan'; end if;
  select * into m from kk_members where phone = p_phone for update;
  if not found then raise exception 'Nomor itu belum terdaftar sebagai member'; end if;
  select count(*) into v_n from kk_posts where member_id = m.user_id and day = v_day;
  if v_n >= kk_prog('posting_per_hari', 1) then raise exception '% sudah klaim bonus posting hari ini', m.nickname; end if;
  -- Syarat: belanja hari ini (nota sudah dimasukkan di Kolam Koi oleh member ini)
  if not exists (select 1 from kk_receipts r where r.claimed_by = m.user_id and r.claimed_at >= v_mulai and r.total >= v_min) then
    raise exception '% belum punya nota belanja hari ini minimal Rp%. Minta pelanggan memasukkan notanya di Kolam Koi dulu', m.nickname, replace(to_char(v_min, 'FM999,999,999'), ',', '.');
  end if;
  insert into kk_posts(member_id, day, choice, link, staff_id) values (m.user_id, v_day, p_choice, left(coalesce(trim(p_link), ''), 300), auth.uid());
  if p_choice = 'esteh' then
    v_code := kk_give_bonus(m.user_id, 'Es teh gratis · bonus posting');
  else
    update kk_members set bonus_pulls = bonus_pulls + 1 where user_id = m.user_id;
  end if;
  return jsonb_build_object('nickname', m.nickname, 'choice', p_choice, 'code', v_code);
end $$;

-- Reset PIN member yang lupa (khusus pemilik)
create or replace function public.kk_reset_pin(p_phone text, p_pin text) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not kk_is_owner() then raise exception 'Khusus pemilik'; end if;
  if p_pin !~ '^[0-9]{6}$' then raise exception 'PIN harus 6 angka'; end if;
  update auth.users set encrypted_password = extensions.crypt(p_pin, extensions.gen_salt('bf')), updated_at = now()
   where email = p_phone || '@member.tjapduakoi.id';
  if not found then raise exception 'Member dengan nomor itu tidak ada'; end if;
end $$;

-- Jadikan akun email sebagai kasir/pemilik (khusus pemilik). Akunnya harus sudah daftar di halaman admin.
create or replace function public.kk_set_staff(p_email text, p_role text, p_name text default '') returns void
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not kk_is_owner() then raise exception 'Khusus pemilik'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'Akun % belum daftar di halaman admin', p_email; end if;
  if p_role is null then
    if uid = auth.uid() then raise exception 'Tidak bisa menghapus diri sendiri'; end if;
    delete from kk_staff where user_id = uid; return;
  end if;
  insert into kk_staff(user_id, role, name) values (uid, p_role, coalesce(p_name, ''))
    on conflict (user_id) do update set role = excluded.role, name = excluded.name;
end $$;

-- Ringkasan untuk halaman admin
create or replace function public.kk_admin_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare a timestamptz := date_trunc('day', now() at time zone 'Asia/Makassar') at time zone 'Asia/Makassar';
begin
  if not kk_is_staff() then raise exception 'Khusus kasir'; end if;
  return jsonb_build_object(
    'members', (select count(*) from kk_members),
    'members_today', (select count(*) from kk_members where created_at >= a),
    'receipts_today', (select count(*) from kk_receipts where created_at >= a),
    'claimed_today', (select count(*) from kk_receipts where claimed_at >= a),
    'vouchers_open', (select count(*) from kk_exchanges where kind in ('hadiah','bonus') and used_at is null),
    'ajak_today', (select count(*) from kk_members where ref_done_at >= a),
    'posts_today', (select count(*) from kk_posts where created_at >= a),
    'role', (select role from kk_staff where user_id = auth.uid())
  );
end $$;

-- ---------- Hak akses fungsi ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.kk_me(), public.kk_update_profile(text, boolean), public.kk_claim(text, integer),
  public.kk_exchange(jsonb, text), public.kk_add_receipt(text, integer), public.kk_add_receipts(jsonb),
  public.kk_delete_receipt(text), public.kk_check_voucher(text), public.kk_use_voucher(text),
  public.kk_reset_pin(text, text), public.kk_set_staff(text, text, text), public.kk_admin_summary(),
  public.kk_is_staff(), public.kk_is_owner(),
  public.kk_use_ref(text), public.kk_pull_bonus(), public.kk_posting_bonus(text, text, text), public.kk_posting_status(text)
  to authenticated;
grant execute on function public.kk_board(date), public.kk_ref_check(text) to anon, authenticated;

-- ---------- Izin baca tabel ----------
-- Project Supabase baru tidak lagi memberi izin otomatis. Hanya SELECT;
-- baris mana yang boleh dilihat tetap diatur policy di atas, dan semua
-- perubahan data tetap lewat fungsi.
grant usage on schema public to anon, authenticated;
grant select on public.kk_cards, public.kk_tiers, public.kk_rewards, public.kk_skins, public.kk_program to anon, authenticated;
grant select on public.kk_staff, public.kk_members, public.kk_receipts, public.kk_inventory,
  public.kk_collection, public.kk_pulls, public.kk_exchanges, public.kk_posts to authenticated;

-- Member lama yang belum punya kode ajak
update public.kk_members set ref_code = public.kk_new_ref_code(nickname) where ref_code is null;
