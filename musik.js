/* Pemutar musik Toko Teh Tjap Dua Koi.
   Memutar file MP3 dari config.js -> musik.file (bawaan: lagu orisinal "Teh Tarik Sore").
   Memakai pemutar audio biasa supaya tetap bersuara di iPhone mode senyap dan di
   browser bawaan Instagram/WhatsApp/TikTok. File baru diunduh saat tombol diketuk. */
(function () {
  "use strict";
  var C = (window.KOI_CONFIG && window.KOI_CONFIG.musik) || {};
  var wadah = document.getElementById("musik");
  var file = String(C.file || "").trim();
  if (!wadah || C.tampil === false || !file) return;

  var tombol = wadah.querySelector("button");
  var teks = wadah.querySelector(".musik__teks");
  var judul = C.judul || "Teh Tarik Sore";
  var audio = new Audio();
  audio.loop = true;
  audio.preload = "none";
  audio.src = file;
  var dijedaOtomatis = false;

  wadah.hidden = false;
  tombol.title = judul;

  function tampil(status) { // "mati" | "memuat" | "nyala" | "gagal"
    var on = status === "nyala" || status === "memuat";
    tombol.setAttribute("aria-pressed", on ? "true" : "false");
    tombol.setAttribute("aria-label", (on ? "Jeda musik " : "Putar musik ") + judul);
    wadah.classList.toggle("is-nyala", status === "nyala");
    wadah.classList.toggle("is-memuat", status === "memuat");
    teks.textContent = { mati: "Putar musik", memuat: "Memuat...", nyala: "Jeda musik", gagal: "Coba lagi" }[status];
  }

  function main() {
    tampil("memuat");
    var p = audio.play();
    if (p && p.catch) p.catch(function () { tampil("gagal"); });
  }
  function jeda() { audio.pause(); tampil("mati"); }

  tombol.addEventListener("click", function () { audio.paused ? main() : jeda(); });
  audio.addEventListener("playing", function () { tampil("nyala"); });
  audio.addEventListener("waiting", function () { if (!audio.paused) tampil("memuat"); });
  audio.addEventListener("pause", function () { if (!dijedaOtomatis) tampil("mati"); });
  audio.addEventListener("error", function () { tampil("gagal"); });

  // Jeda saat pindah aplikasi/tab, lanjut lagi saat kembali
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && !audio.paused) { dijedaOtomatis = true; audio.pause(); }
    else if (!document.hidden && dijedaOtomatis) { dijedaOtomatis = false; main(); }
  });

  // Judul lagu di layar kunci / notifikasi HP
  if ("mediaSession" in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: judul, artist: "Toko Teh Tjap Dua Koi",
      artwork: [{ src: "assets/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
    });
  }

  tampil("mati");
})();
