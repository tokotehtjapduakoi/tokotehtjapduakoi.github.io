# Website Toko Teh Tjap Dua Koi

Alamat: **https://tokotehtjapduakoi.github.io**
*Sepasang koi, segelas teh.*

Website ringan tanpa framework: `index.html`, `styles.css`, `app.js`, dan **`config.js`**.

## Cara mengubah link, nomor WA, atau cabang (lewat HP)

Semua yang sering berubah ada di **satu file: `config.js`**. File lain tidak perlu disentuh.

1. Buka `https://github.com/tokotehtjapduakoi/tokotehtjapduakoi.github.io` di browser HP (Chrome/Safari), pastikan sudah login.
2. Ketuk file **`config.js`**.
3. Ketuk ikon **pensil** (Edit this file). Kalau tidak terlihat, ketuk menu `...` lalu **Edit file**.
4. Ubah hanya teks di antara tanda kutip `"..."`. Jangan hapus koma di akhir baris.
5. Ketuk **Commit changes...** lalu **Commit changes** lagi.
6. Tunggu 1–2 menit, buka website, tarik layar ke bawah untuk muat ulang.

### Contoh perubahan

| Mau mengubah | Bagian di `config.js` |
|---|---|
| Nomor WhatsApp | `nomor: "6281345306571"` (pakai 62, tanpa 0 di depan) dan `tampil: "0813 4530 6571"` |
| Pesan otomatis WA | `pesanTemanTarik`, `pesanEvent`, `pesanUmum` |
| Instagram / TikTok | `username` dan `link` di bagian `instagram` / `tiktok` |
| GoFood / GrabFood | tempel link toko di `gofood: ""` / `grabfood: ""`; tombol "SEGERA" otomatis berubah jadi aktif |
| Cabang | daftar `cabang: [ ... ]` |

### Menambah cabang

Salin satu blok cabang, tempel di bawahnya, beri **koma** di antara dua blok:

```js
cabang: [
  {
    nama: "Mahakam Lampion Garden",
    alamat: "Caravan Toko Teh di area Mahakam Lampion Garden",
    kota: "Samarinda",
    jam: "",
    maps: "https://www.google.com/maps/search/?api=1&query=Mahakam+Lampion+Garden+Samarinda",
    status: "buka"
  },
  {
    nama: "Cabang Baru",
    alamat: "Jl. Contoh No. 1",
    kota: "Balikpapan",
    jam: "16.00 - 23.00",
    maps: "",
    status: "segera"
  }
]
```

`status: "segera"` menampilkan label **Segera hadir**; ganti ke `"buka"` saat cabang sudah beroperasi.

**Kalau website tiba-tiba kosong/tombol hilang** setelah mengedit, biasanya ada koma atau tanda kutip yang terhapus. Buka `config.js` lagi, ketuk tab **History**, dan bandingkan dengan versi sebelumnya — atau minta Claude memperbaikinya.

## Mengganti logo

Logo diambil apa adanya dari file asli. Untuk mengganti, unggah file baru dengan nama yang sama ke folder `assets/`:
`logo.png` (560×560), `favicon-32.png`, `favicon-16.png`, `apple-touch-icon.png` (180×180), `og-image.jpg` (1200×630, gambar preview saat link dibagikan).

## Teknis

- GitHub Pages dari branch `main`, folder root. Tanpa domain berbayar, tanpa CNAME.
- `.nojekyll` membuat GitHub menyajikan file apa adanya.
- Animasi lampion & koi otomatis berhenti untuk pengguna yang mengaktifkan "kurangi gerakan" di HP-nya.
