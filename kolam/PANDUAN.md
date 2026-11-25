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
