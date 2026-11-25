# Kolam Koi: cara mengaktifkan

- Halaman member: **https://tokotehtjapduakoi.github.io/kolam/**
- Halaman kasir & pemilik: **https://tokotehtjapduakoi.github.io/kolam/admin/**

Selama `kolam/config.js` masih kosong, halaman member menampilkan **"Segera dibuka"**.
Ikuti langkah di bawah sekali saja (±15 menit).

## 1. Buat project Supabase baru (gratis)
1. Buka https://supabase.com/dashboard → **New project**.
2. Nama: `kolam-koi`. Region: **Southeast Asia (Singapore)**. Simpan password database di tempat aman.
3. Tunggu sampai project siap.

## 2. Pasang database
1. Menu **SQL Editor** → **New query**.
2. Buka file `kolam/setup.sql` di GitHub (tombol **Raw**), salin semua, tempel, lalu **Run**. Harus muncul "Success".

## 3. Atur login
Menu **Authentication**:
1. **Sign In / Providers → Email**: matikan **Confirm email**, lalu Save. Wajib, karena member masuk dengan nomor HP, bukan email asli.
2. Pastikan **Allow new users to sign up** menyala.
3. **Rate Limits**: naikkan **Sign-ups and sign-ins** ke sekitar **150 per 5 menit**. Pelanggan yang memakai WiFi toko berbagi satu alamat internet, dan batas bawaannya terlalu kecil.

## 4. Sambungkan website
1. Menu **Project Settings → API Keys** (atau **Data API**). Salin:
   - **Project URL**, contohnya `https://abcdxyz.supabase.co`
   - **Publishable key** (dulu bernama *anon public*)
2. Di GitHub, edit `kolam/config.js` dan isi `supabaseUrl` serta `supabaseKey`. Commit.
   Jangan pernah memakai kunci **secret / service_role** di sini.

## 5. Jadikan dirimu pemilik
1. Buka `/kolam/admin/` → **Daftar akun staf** dengan email dan kata sandimu sendiri.
2. Kembali ke Supabase **SQL Editor**, jalankan (ganti emailnya):
   ```sql
   insert into kk_staff(user_id, role, name)
   select id, 'pemilik', 'Pemilik' from auth.users where email = 'emailkamu@gmail.com';
   ```
3. Muat ulang halaman admin. Sekarang menu Nota, Voucher, Member, dan Staf terbuka.

Untuk kasir: minta mereka daftar di halaman admin dengan email masing-masing, lalu tambahkan email itu di menu **Staf**.

## Alur harian
1. Pelanggan bayar di ESB. Kasir membuka **Admin → Nota**, lalu mengetik nomor nota dan total.
2. Pelanggan membuka Kolam Koi dan mengetik nomor nota serta total yang sama. Kartu ditarik dan langsung masuk ke kolam.
3. Saat pelanggan menukar hadiah, ia menunjukkan kode `TK-XXXXX`. Kasir membuka **Admin → Voucher**, cek kodenya, berikan hadiahnya, lalu ketuk **tandai dipakai**.
4. Kalau pelanggan lupa PIN, pemilik membuka **Admin → Member**, cari nomornya, buat PIN baru, lalu kirim lewat WA.

## Aturan yang dipakai
- Tarikan per nota: Rp20rb = 1, Rp45rb = 2, Rp60rb = 3, Rp80rb = 4, Rp100rb = 5.
- Peluang: Rare 80%, Super Rare 17%, Ultra Rare 3%. Super Rare dijamin paling lambat tiap 10 tarikan, Ultra Rare tiap 40.
- Poin kartu: R = 1, SR = 5, UR = 25. Hadiah: 12 / 30 / 60 / 120 / 300 poin.
- Satu nota hanya bisa dipakai sekali. Pelanggan harus mengetik nomor **dan** total yang benar. Setelah 10 kali salah dalam sehari, akun dikunci sampai besok.

Hadiah, poin, dan jumlah tarikan bisa diubah di Supabase **Table Editor** (`kk_rewards`, `kk_tiers`, `kk_skins`). Website membaca angka barunya otomatis.

## Teman Tarik: ajak teman pakai kode (mulai 25 Nov 2026)

**Cara memasang (sekali saja):** buka `https://tokotehtjapduakoi.github.io/kolam/admin/sql.html` di HP,
ketuk **Salin semua SQL**, lalu di Supabase **SQL Editor** hapus isi lama, tempel, dan **Run**.
Aman dijalankan ulang: data member, kartu, dan voucher yang sudah ada tidak hilang. Member lama otomatis dapat kode ajak.

**Aturannya:**
- Setiap member punya kode ajak, misalnya `RINAK-MXA`, di tab **Tarik**. Ada tombol kirim lewat WhatsApp dengan link daftar yang kodenya sudah terisi.
- Kode hanya bisa dipakai **member baru**: saat daftar, atau di tab Tarik sebelum belanja pertama. Satu nomor HP hanya bisa memakai satu kode, sekali.
- Saat teman itu memasukkan nota pertama dengan total **minimal Rp20.000**, sistem otomatis memberi:
  - teman: voucher **"Es teh gratis · hadiah teman baru"**
  - pengajak: voucher **"Es teh gratis · ajak <nama teman>"**, maksimal **15 per bulan**. Setelah batas itu, temannya tetap dapat, pengajaknya tidak.
- Voucher muncul di **Hadiahku**. Kasir memakainya seperti voucher biasa di **Admin → Voucher**.

**Bonus posting:**
1. Pelanggan menunjukkan post/story yang men-tag **@tokoteh.tjapduakoi**.
2. Kasir membuka **Admin → Posting**, ketik nomor HP pelanggan, lalu ketuk pilihan pelanggan:
   - **Es teh gratis**: muncul kode voucher. Berikan es tehnya, lalu tandai kode itu dipakai di tab Voucher.
   - **+1 tarikan kartu**: pelanggan menarik kartunya sendiri di tab Tarik (tombol "Tarik kartu bonus").
3. Berlaku **1 kali sehari** per member.

**Mengubah angka program:** Supabase → **Table Editor** → `kk_program`:
`ajak_min_belanja` (20000), `ajak_maks_per_bulan` (15), `posting_per_hari` (1).
