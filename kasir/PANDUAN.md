# Kasir Koi: cara memasang dan memakai

- Halaman kasir & pemilik: **https://tokotehtjapduakoi.github.io/kasir/**
- Admin Kolam Koi (staf, nota lama): **https://tokotehtjapduakoi.github.io/kolam/admin/**

Kasir Koi memakai database Supabase yang sama dengan Kolam Koi. Ikuti langkah 1 sampai 6 sekali saja. Semua bisa dikerjakan dari HP.

## 1. Pasang database
1. Buka Supabase → project Kolam Koi → menu **SQL Editor** → **New query**.
2. Buka `kolam/setup.sql` di GitHub (tombol **Raw**), salin semua, tempel, **Run**. Harus muncul "Success". Ini versi baru, jadi wajib dijalankan lagi.
3. **New query** lagi. Buka `kasir/setup.sql`, salin semua, tempel, **Run**. Harus muncul "Success".

Urutannya harus: `kolam/setup.sql` dulu, baru `kasir/setup.sql`. Keduanya aman dijalankan ulang. Kalau suatu hari `kolam/setup.sql` dijalankan ulang, jalankan `kasir/setup.sql` lagi sesudahnya.

## 2. Aktifkan verifikasi 2 langkah
1. Supabase → menu **Authentication** → **Sign In / Providers** (atau **Multi-Factor**).
2. Nyalakan **TOTP** (verifikasi 2 langkah dengan aplikasi Authenticator). Simpan.
3. Di HP pemilik, pasang **Google Authenticator** dari Play Store / App Store.

## 3. Isi nomor HP staf
1. Setiap kasir mendaftar dulu di `/kolam/admin/` → **Daftar akun staf** dengan email dan kata sandi sendiri (sandi minimal 10 karakter).
2. Pemilik membuka `/kolam/admin/` → **Staf**, lalu isi email, nama, nomor HP (contoh 0812 3456 7890), dan peran **Kasir**. Ketuk **Simpan**.

## 4. Pemilik: masuk dan setujui HP sendiri
1. Buka `/kasir/` → masuk dengan email dan sandi pemilik.
2. Menu pemilik (Laporan, Setujui, Atur) meminta verifikasi 2 langkah. Ikuti layar: pindai kode QR dengan Google Authenticator, lalu ketik 6 angkanya. Cukup sekali. Halaman `/kolam/admin/` memakai 2 langkah yang sama.
3. Buka tab **Setujui** → di bawah **Perangkat menunggu**, ketuk **Setujui** untuk HP sendiri.

## 5. Isi menu, harga, metode bayar, diskon
Buka tab **Atur**:
1. **Menu**: tambah menu dan ukurannya, isi harga (angka saja), ketuk simpan.
2. **Metode bayar**: cek daftar yang ada (tunai, QRIS, dan sebagainya). Nanti kalau sudah daftar, tambahkan **QRIS GoPay** dan **QRIS ShopeePay** di sini.
3. **Diskon**: tambah diskon (persen atau rupiah) kalau perlu.

Setiap perubahan harga, menu, metode bayar, diskon, dan perangkat tercatat otomatis.

## 6. Kasir: login dan pasang di HP
1. Kasir membuka `/kasir/` di HP masing-masing, masuk dengan email dan sandi, boleh isi nama HP (contoh "HP kasir depan").
2. Layar menampilkan **Menunggu persetujuan pemilik**. Pemilik membuka tab **Setujui** dan ketuk **Setujui** untuk HP itu. Kasir ketuk **Cek lagi**.
3. Pasang ke layar utama supaya seperti aplikasi:
   - **Android (Chrome):** ketuk **⋮** → **Tambahkan ke layar utama**.
   - **iPhone (Safari):** ketuk **Bagikan** → **Tambah ke Layar Utama**.

Kasir otomatis keluar kalau 30 menit tidak dipakai. Keluar ditolak selama masih ada nota yang belum terkirim.

## 7. Alur harian
1. **Buka toko:** kasir masuk, ketik modal awal (uang di laci), ketuk **Buka toko**.
2. **Jual:** tab **Jual** → ketuk menu → pilih metode bayar (dan diskon bila ada) → ambil foto bukti (wajib) → **Lunas**. Layar menampilkan **kode klaim** `XXXXX-XXXXX` dan tombol **Kirim WA**.
3. **Pelanggan klaim kartu:** kasir menunjukkan kode atau mengirimnya lewat WA. Pelanggan membuka Kolam Koi, ketik kode, kartu langsung masuk ke kolam. Kode berlaku 7 hari kalau terikat nomor HP, 2 jam kalau tidak.
4. **Salah input:** kasir mengajukan batal di tab **Nota**. Pemilik memutuskan di tab **Setujui** (**Pengajuan batal**).
5. **Serah terima / tutup:** ganti kasir → ketuk tab **Kas** → **Serahkan laci**, lalu kasir berikutnya menerima laci. Kasir terakhir → **Tutup toko sekarang**.
6. **Pemilik:** tab **Laporan** menampilkan omzet, rata-rata nota, menu terlaris, dan selisih kas tiap shift.

## 8. Masa berdampingan dengan ESB
Selama ESB masih dipakai:
- Kasir tetap mengetik transaksi di ESB seperti biasa dan juga di Kasir Koi. Kode klaim dari Kasir Koi-lah yang diberikan ke pelanggan untuk kartu Kolam Koi.
- **Jangan** daftarkan nota ESB di **Admin Kolam Koi → Nota**, supaya satu pembelian tidak dihitung dua kali.
- Setelah angka Kasir Koi dan ESB cocok beberapa hari, matikan **Admin Kolam Koi → Nota → Klaim nomor nota lama (ESB)**. Sesudah itu pelanggan hanya bisa klaim dengan kode.

## 9. Kalau ada masalah
- **Kasir lupa kata sandi:** pemilik membuka Supabase → **Authentication** → **Users**, cari emailnya, lalu atur ulang sandi (kirim link reset atau isi sandi baru).
- **HP hilang atau diganti:** pemilik buka **Atur → Perangkat**, ketuk **Cabut** di HP itu (ketuk sekali lagi untuk yakin). HP itu langsung tidak bisa dipakai jualan. HP baru cukup masuk dan disetujui lagi.
- **Internet putus:** tetap jualan seperti biasa. Nota tersimpan di HP ("Tersimpan di HP, akan terkirim otomatis") dan terkirim sendiri begitu internet kembali. Jangan keluar akun sebelum antrean kosong.
- **Nota ditolak server:** muncul di tab **Nota** dengan alasannya. Jangan diulang sendiri. Ketuk tombol laporan untuk mengirim ke pemilik lewat WhatsApp, lalu pemilik memeriksanya.
- **Harga berubah saat jualan:** menu dimuat ulang otomatis, cek total lalu simpan lagi.
- **Layar bilang "butuh verifikasi 2 langkah":** buka Google Authenticator, ketik 6 angkanya.
