# Harness uji

Jalankan `python3 -m pytest -q` dari folder `_uji/` (perlu Postgres 16 di `/usr/lib/postgresql/16/bin` dan akses root/`su postgres`). Tiap sesi pytest membuat cluster Postgres sementara (port 54329), lalu tiap uji mendapat database baru berisi Supabase tiruan (`supabase_tiruan.sql`), `kolam/setup.sql`, dan `kasir/setup.sql` bila ada. `db.sql(q, sebagai=klaim)` menjalankan `q` sebagai role `authenticated`/`anon` dengan RLS berlaku; error SQL dilempar sebagai `SqlError`.

## Uji e2e (halaman kasir)

Sekali: `npm install` di `_uji/` (hanya `pg`). Playwright dipakai dari instalasi global `/opt/node-tools` (tidak memasang browser/`@playwright/test`). Jalankan dari `_uji/`:

```
node --test 'e2e/*.spec.mjs'
```

Tiap file uji memanggil `siapkanDb()` (`python3 db.py --buat`: cluster + database baru berisi tiruan, kolam, kasir, dan data contoh; mencetak `{"conninfo": ...}` lalu menunggu sampai stdin ditutup/SIGTERM, saat itu cluster dihentikan dan dihapus) dan `jalankanServer()` (`server_tiruan.mjs`: web statis repo + auth/rpc/storage tiruan, token JWT HS256 rahasia `uji`). Akun contoh (sandi `rahasia1`): `pemilik@uji.id` (pemilik, selalu aal2), `ocha@uji.id` dan `budi@uji.id` (kasir), `tamu@uji.id` (bukan staf).

## Simulasi laporan (database uji saja)

`node simulasi_rentang.mjs [folder]` membuat database uji baru (seperti e2e), mengisi data penjualan acak berbenih dari tanggal 1 dua bulan sebelum bulan ini sampai kemarin (WITA), lalu menyimpan tangkapan layar laporan pemilik ukuran iPhone (390×844) dan `RINGKASAN.md` ke folder itu (bawaan `/home/user/CLAUDE/rancangan/simulasi`). Tidak pernah menghubungi Supabase asli. Jangan dijalankan bersamaan dengan pytest/e2e (port Postgres sama).
