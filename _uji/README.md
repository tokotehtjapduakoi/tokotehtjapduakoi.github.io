# Harness uji

Jalankan `python3 -m pytest -q` dari folder `_uji/` (perlu Postgres 16 di `/usr/lib/postgresql/16/bin` dan akses root/`su postgres`). Tiap sesi pytest membuat cluster Postgres sementara (port 54329), lalu tiap uji mendapat database baru berisi Supabase tiruan (`supabase_tiruan.sql`), `kolam/setup.sql`, dan `kasir/setup.sql` bila ada. `db.sql(q, sebagai=klaim)` menjalankan `q` sebagai role `authenticated`/`anon` dengan RLS berlaku; error SQL dilempar sebagai `SqlError`.
