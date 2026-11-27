# Kasir Koi: cara memasang dan memakai

- Halaman kasir & pemilik: **https://tokotehtjapduakoi.github.io/kasir/**
- Admin Kolam Koi (staf, nota ESB): **https://tokotehtjapduakoi.github.io/kolam/admin/**
- Salin SQL dari HP: **https://tokotehtjapduakoi.github.io/kolam/admin/sql.html**

Kasir Koi memakai database Supabase yang sama dengan Kolam Koi. Langkah 0 sampai 6 cukup sekali. Semua bisa dikerjakan dari HP.

## 0. Kapan memasang
Pindah dari ESB pelan-pelan, tanpa tanggal pasti. Jadi:
- **Pasang kapan saja.** Database baru (langkah 1) dan website baru tidak mengganggu cara kerja sekarang. Website baru tampil setelah perubahan digabung ke branch `main` di GitHub (minta Claude kalau perlu).
- **Selama masa transisi**, kasir tetap mendaftarkan nota ESB di **Admin Kolam Koi → Nota** seperti biasa. Sakelar **Nota manual oleh kasir** menyala dari awal, jadi kasir tidak perlu apa-apa yang baru.
- **Satu pembelian, satu jalan:** kalau penjualan diketik di Kasir Koi, berikan kode klaim dari Kasir Koi dan **jangan** daftarkan nota ESB-nya. Kalau penjualan hanya di ESB, daftarkan nota ESB seperti biasa.
- **Saat ESB berhenti dipakai**, pemilik membuka **Admin Kolam Koi → Nota** dan mematikan **dua** sakelar: **Nota manual oleh kasir** dan **Klaim nomor nota lama (ESB)**. Sesudah itu pelanggan hanya bisa klaim dengan kode dari Kasir Koi.

## 1. Pasang database
1. Di HP, buka **/kolam/admin/sql.html**. Ketuk **1. Kolam Koi** → tombol hijau **Salin semua SQL Kolam Koi**.
2. Buka Supabase → project Kolam Koi → **SQL Editor** → **New query**. Tekan lama di area kosong → **Paste** → **Run**. Harus muncul "Success".
3. Kembali ke halaman salin SQL, ketuk **2. Kasir Koi** → **Salin semua SQL Kasir Koi**. Di Supabase: **New query** → **Paste** → **Run**. Harus muncul "Success".

Urutannya harus: Kolam Koi dulu, baru Kasir Koi. Keduanya aman dijalankan ulang. Kalau suatu hari Kolam Koi dijalankan ulang, jalankan Kasir Koi lagi sesudahnya.

## 2. Pasang verifikasi 2 langkah (pemilik)
Menu pemilik (Staf, Nota, reset PIN, Laporan, Setujui, Atur) wajib memakai verifikasi 2 langkah. Pasang dulu sebelum mengatur staf.
1. Supabase → **Authentication** → **Sign In / Providers** (atau **Multi-Factor**). Nyalakan **TOTP**. Simpan.
2. Di HP pemilik, pasang **Google Authenticator** dari Play Store / App Store.
3. Buka **/kolam/admin/** → masuk dengan email dan sandi pemilik. Muncul kotak **Verifikasi 2 langkah** → ketuk **Pasang verifikasi 2 langkah**.
4. Di Google Authenticator ketuk **+** → **Pindai kode QR**, arahkan ke gambar di layar. (Kalau di HP yang sama: salin kode rahasia di bawah gambar, lalu pilih **Masukkan kunci penyiapan** di Google Authenticator.)
5. Ketik 6 angka dari Google Authenticator → **Verifikasi**.

Cukup sekali. Setiap kali masuk lagi, halaman meminta 6 angka yang baru dari Google Authenticator. **/kasir/** memakai verifikasi yang sama.

## 3. Daftarkan staf dan nomor HP
1. Setiap kasir mendaftar dulu di **/kolam/admin/** → **Daftar akun staf** dengan email dan kata sandi sendiri (sandi minimal 10 karakter).
2. Pemilik membuka **/kolam/admin/** → **Staf** (setelah verifikasi 2 langkah), isi email, nama, nomor HP (contoh 0812 3456 7890), dan peran **Kasir**. Ketuk **Simpan**.
3. **Isi juga untuk dirimu sendiri:** email pemilik, nama, nomor HP-mu, peran **Pemilik**. Nomor HP staf dipakai supaya staf tidak bisa mengklaim kartu dari nota buatannya sendiri.

## 4. Pemilik: masuk dan setujui HP sendiri
1. Buka **/kasir/** → masuk dengan email dan sandi pemilik.
2. Buka tab **Laporan**, **Setujui**, atau **Atur** → ketik 6 angka dari Google Authenticator.
3. Tab **Setujui** → di bawah **Perangkat menunggu**, ketuk **Setujui** untuk HP sendiri.

## 5. Isi menu, harga, metode bayar, diskon
Buka tab **Atur**:
1. **Menu**: tambah menu dan ukurannya, isi harga (angka saja), ketuk simpan.
2. **Metode bayar**: cek daftar yang ada (tunai, QRIS, dan sebagainya). Nanti kalau sudah daftar, tambahkan **QRIS GoPay** dan **QRIS ShopeePay** di sini.
3. **Diskon**: tambah diskon (persen atau rupiah) kalau perlu.

Setiap perubahan harga, menu, metode bayar, diskon, dan perangkat tercatat otomatis.

## 6. Kasir: login dan pasang di HP
1. Kasir membuka **/kasir/** di HP masing-masing, masuk dengan email dan sandi, boleh isi nama HP (contoh "HP kasir depan").
2. Layar menampilkan **Menunggu persetujuan pemilik**. Pemilik membuka tab **Setujui** dan ketuk **Setujui** untuk HP itu. Kasir ketuk **Cek lagi**.
3. Pasang ke layar utama supaya seperti aplikasi:
   - **Android (Chrome):** ketuk **⋮** → **Tambahkan ke layar utama**.
   - **iPhone (Safari):** ketuk **Bagikan** → **Tambah ke Layar Utama**.

Kasir otomatis keluar kalau 30 menit tidak dipakai. Keluar ditolak selama masih ada nota yang belum terkirim.

## 7. Alur harian
1. **Buka toko:** kasir masuk, ketik modal awal (uang di laci), ketuk **Buka toko**.
2. **Jual:** tab **Jual** → ketuk menu → pilih metode bayar (dan diskon bila ada) → ambil foto bukti (wajib) → **Lunas**. Layar menampilkan **QR**; kode klaim `XXXXX-XXXXX` tampil kecil di bawahnya.
3. **Pelanggan klaim kartu:** kasir menunjukkan QR di layar. Pelanggan scan dengan kamera HP-nya: WhatsApp terbuka ke nomor WhatsApp toko dengan teks nota yang sudah terisi, pelanggan tinggal ketuk **Kirim**, lalu ketuk tautan **Tarik kartu koi** di teks itu untuk membuka Kolam Koi. Kode berlaku 24 jam kalau tidak terikat nomor HP, 7 hari kalau terikat nomor HP.
4. **Salah input:** kasir mengajukan batal di tab **Nota**. Pemilik memutuskan di tab **Setujui** (**Pengajuan batal**).
5. **Ganti kasir:** tab **Kas** → ketuk **Serah terima ke kasir berikutnya** → hitung uang, foto laci → **Serahkan laci**. Kasir berikutnya masuk di HP-nya, menghitung uang, lalu ketuk **Terima laci**.
6. **Tutup toko:** kasir terakhir → tab **Kas** → **Tutup toko** → hitung uang, foto laci → **Tutup toko sekarang**.
7. **Pemilik:** tab **Laporan** menampilkan omzet, rata-rata nota, menu terlaris, selisih kas tiap shift, dan hal yang perlu diperiksa.

**Kalau pemilik ikut jualan:** pemilik memakai tab **Jual** seperti kasir. Tab **Kas** dan **Nota** untuk pemilik ada di **Atur** → tombol **Kas shift saya** dan **Nota shift ini** (muncul setelah toko dibuka).

**Ambil / tambah uang laci (pemilik):** misalnya setor ke bank, ambil untuk keperluan pribadi, atau menambah uang kecil untuk kembalian.
1. Buka **Atur → Laci kas**. Terlihat uang yang **seharusnya** ada di laci sekarang.
2. Ketuk **Ambil kas** atau **Tambah kas**, ketik jumlahnya, pilih alasan (**Setor ke bank**, **Ambil pribadi**, **Tambah uang kecil**) atau tulis sendiri.
3. **Ambil kas wajib foto** uang yang diambil (tambah kas boleh tanpa foto).
4. Ketuk **Catat**, lalu ketuk sekali lagi untuk yakin. Layar menampilkan uang yang seharusnya ada di laci sesudahnya. Ambil kas tidak bisa lebih besar dari uang yang seharusnya ada.
- Bisa dicatat saat toko buka (shift kasir siapa pun) atau **setelah tutup toko** sebelum toko dibuka lagi. Kalau dicatat setelah tutup, modal awal besok = hitungan tutup toko − ambil + tambah, jadi tidak muncul peringatan modal awal yang salah.
- Tidak bisa dicatat saat laci sedang diserahterimakan antar kasir (tunggu sampai diterima).
- Kasir tidak melihat jumlahnya; di tab **Kas** kasir hanya melihat tulisan "Pemilik mencatat ambil/tambah kas hari ini". Hitungan laci kasir tetap tanpa contekan.
- Semua catatan muncul di **Laporan** (Harian: bagian **Ambil / tambah kas** dan baris shift; Rentang: bagian **Catatan**).

**Nota ditahan:** nota yang dibuat saat offline di HP yang kemudian dicabut muncul di **Setujui → Nota ditahan**. Periksa rinciannya dan fotonya, lalu ketuk **Lepas tahanan** dua kali. Kode klaimnya langsung bisa dipakai lagi.

## 8. Kalau ada masalah
- **Kasir lupa kata sandi:** pemilik membuka Supabase → **SQL Editor** → **New query**, tempel lalu **Run** (ganti sandi baru minimal 10 karakter dan emailnya):
  ```sql
  update auth.users set encrypted_password = extensions.crypt('SANDI_BARU', extensions.gen_salt('bf'))
  where email = 'emailkasir@gmail.com';
  ```
  Beri tahu kasir sandi barunya, lalu minta ia menggantinya sendiri bila bisa.
- **HP hilang atau diganti:** pemilik buka **Atur → Perangkat**, ketuk **Cabut** di HP itu (ketuk sekali lagi untuk yakin). HP itu langsung tidak bisa dipakai jualan. HP baru cukup masuk dan disetujui lagi.
- **Internet putus:** tetap jualan seperti biasa. Nota tersimpan di HP ("Tersimpan di HP, akan terkirim otomatis") dan terkirim sendiri begitu internet kembali. Jangan keluar akun sebelum antrean kosong.
- **Nota ditolak server:** muncul di tab **Nota** dengan alasannya. Jangan diulang sendiri. Ketuk tombol laporan untuk mengirim ke pemilik lewat WhatsApp, lalu pemilik memeriksanya.
- **"Jam HP tidak sesuai":** atur jam HP ke otomatis (Pengaturan → Tanggal & waktu → Otomatis), lalu coba lagi.
- **Harga berubah saat jualan:** menu dimuat ulang otomatis, cek total lalu simpan lagi.
- **Layar bilang "butuh verifikasi 2 langkah":** buka Google Authenticator, ketik 6 angkanya.
