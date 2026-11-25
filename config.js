/* =====================================================================
   PENGATURAN WEBSITE TOKO TEH TJAP DUA KOI
   ---------------------------------------------------------------------
   Ini SATU-SATUNYA file yang perlu diubah untuk mengganti link,
   nomor WhatsApp, pesan otomatis WA, dan daftar cabang.

   Aturan aman saat mengedit:
   - Ubah hanya teks di antara tanda kutip "...".
   - Jangan hapus tanda koma (,) di akhir baris.
   - Simpan (Commit changes), tunggu 1-2 menit, lalu buka ulang website.
   ===================================================================== */

window.KOI_CONFIG = {

  /* ---------- WhatsApp ---------- */
  whatsapp: {
    // Nomor dengan kode negara 62, tanpa +, spasi, atau angka 0 di depan.
    nomor: "6281345306571",
    // Cara nomor ditampilkan di website.
    tampil: "0813 4530 6571",
    // Pesan yang otomatis terisi saat chat WA terbuka.
    pesanTemanTarik: "Halo Toko Teh Tjap Dua Koi! Aku mau ikut Teman Tarik. Aku diajak oleh: ",
    pesanEvent: "Halo Toko Teh Tjap Dua Koi! Aku mau tanya untuk event: ",
    pesanUmum: "Halo Toko Teh Tjap Dua Koi! "
  },

  /* ---------- Media sosial ---------- */
  instagram: {
    username: "tokoteh.tjapduakoi",
    link: "https://instagram.com/tokoteh.tjapduakoi"
  },
  tiktok: {
    username: "tokoteh.tjapduakoi",
    link: "https://www.tiktok.com/@tokoteh.tjapduakoi"
  },

  /* ---------- Pesan antar ----------
     Kosongkan ("") selama belum ada: tombol tampil "SEGERA" dan tidak bisa diklik.
     Begitu ada link toko di GoFood/GrabFood, tempel di sini dan tombol langsung aktif. */
  pesanAntar: {
    gofood: "",
    grabfood: ""
  },

  /* ---------- Cabang ----------
     Untuk menambah cabang: salin satu blok { ... } beserta komanya,
     tempel di bawahnya, lalu ganti isinya.
     - nama   : nama tempat / cabang
     - alamat : alamat atau patokan singkat
     - kota   : kota
     - jam    : jam buka (boleh dikosongkan "")
     - maps   : link Google Maps (boleh dikosongkan "")
     - status : "buka" atau "segera" (cabang yang akan dibuka) */
  cabang: [
    {
      nama: "Mahakam Lampion Garden",
      alamat: "Caravan Toko Teh di area Mahakam Lampion Garden",
      kota: "Samarinda",
      jam: "",
      maps: "https://www.google.com/maps/search/?api=1&query=Mahakam+Lampion+Garden+Samarinda",
      status: "buka"
    }
    // ,{
    //   nama: "Nama cabang baru",
    //   alamat: "Alamat / patokan",
    //   kota: "Samarinda",
    //   jam: "16.00 - 23.00",
    //   maps: "",
    //   status: "segera"
    // }
  ]
};
