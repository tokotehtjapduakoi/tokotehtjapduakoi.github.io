/* Mengisi link, teks, GoFood/GrabFood, dan cabang dari config.js.
   Tidak perlu diubah — semua pengaturan ada di config.js. */
(function () {
  "use strict";
  var C = window.KOI_CONFIG;
  if (!C) return;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function bersihNomor(n) { return String(n || "").replace(/\D/g, ""); }
  function wa(pesan) {
    var url = "https://wa.me/" + bersihNomor(C.whatsapp && C.whatsapp.nomor);
    return pesan ? url + "?text=" + encodeURIComponent(pesan) : url;
  }
  function amanUrl(u) { return /^https:\/\//i.test(String(u || "").trim()) ? String(u).trim() : ""; }

  var W = C.whatsapp || {};
  var links = {
    temanTarik: C.temanTarik || "kolam/",
    event: wa(W.pesanEvent),
    waUmum: wa(W.pesanUmum),
    instagram: amanUrl(C.instagram && C.instagram.link),
    tiktok: amanUrl(C.tiktok && C.tiktok.link)
  };
  var teks = {
    igUser: C.instagram && C.instagram.username ? "@" + C.instagram.username : "",
    ttUser: C.tiktok && C.tiktok.username ? "@" + C.tiktok.username : "",
    waTampil: W.tampil || ""
  };

  document.querySelectorAll("[data-link]").forEach(function (el) {
    var u = links[el.getAttribute("data-link")];
    if (u) el.setAttribute("href", u);
  });
  document.querySelectorAll("[data-teks]").forEach(function (el) {
    var t = teks[el.getAttribute("data-teks")];
    if (t) el.textContent = t;
  });

  /* ---------- GoFood & GrabFood ---------- */
  var ikonTas = '<svg viewBox="0 0 24 24"><path d="M5 9h14l-1.2 11H6.2z"/><path d="M9 9V7a3 3 0 0 1 6 0v2"/></svg>';
  var panah = '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  var antar = document.getElementById("antar");
  var P = C.pesanAntar || {};
  if (antar) {
    antar.innerHTML = [["GoFood", P.gofood], ["GrabFood", P.grabfood]].map(function (x) {
      var nama = x[0], url = amanUrl(x[1]);
      var ikon = '<span class="card__ikon" aria-hidden="true">' + ikonTas + "</span>";
      if (url) {
        return '<a class="card card--antar" style="background:#fff" href="' + esc(url) + '" target="_blank" rel="noopener">' +
          ikon + '<span class="card__teks"><span class="card__judul">' + nama + '</span><span class="card__sub">Pesan antar</span></span>' +
          '<span class="card__panah" aria-hidden="true">' + panah + "</span></a>";
      }
      return '<div class="card card--antar is-segera" aria-disabled="true">' + ikon +
        '<span class="card__teks"><span class="card__judul">' + nama + '</span><span class="label label--abu">SEGERA</span></span>' +
        '<span class="sr-only"> belum tersedia</span></div>';
    }).join("");
  }

  /* ---------- Cabang ---------- */
  var ikonPin = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>';
  var ikonJam = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
  var ikonPeta = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z"/><path d="M9 4v14M15 6v14"/></svg>';
  var daftar = document.getElementById("daftar-cabang");
  var cabang = Array.isArray(C.cabang) ? C.cabang : [];
  if (daftar && cabang.length) {
    daftar.innerHTML = cabang.map(function (c) {
      var segera = String(c.status || "").toLowerCase() === "segera";
      var lokasi = [c.alamat, c.kota].filter(Boolean).join(", ");
      var maps = amanUrl(c.maps);
      return '<li class="cabang__item">' +
        '<div class="cabang__atas"><h3>' + esc(c.nama) + '</h3><span class="status ' + (segera ? "status--segera\">Segera hadir" : "status--buka\">Buka") + "</span></div>" +
        (lokasi ? '<p class="cabang__baris">' + ikonPin + "<span>" + esc(lokasi) + "</span></p>" : "") +
        (c.jam ? '<p class="cabang__baris">' + ikonJam + "<span>" + esc(c.jam) + "</span></p>" : "") +
        (maps ? '<a class="cabang__maps" href="' + esc(maps) + '" target="_blank" rel="noopener">' + ikonPeta + "Buka di Google Maps</a>" : "") +
        "</li>";
    }).join("");
  }

  /* ---------- Tahun di footer ---------- */
  var th = document.getElementById("tahun");
  if (th) th.textContent = new Date().getFullYear();

  /* ---------- Data terstruktur untuk Google ---------- */
  var ld = {
    "@context": "https://schema.org",
    "@type": "CafeOrCoffeeShop",
    name: "Toko Teh Tjap Dua Koi",
    slogan: "Sepasang koi, segelas teh.",
    url: "https://tokotehtjapduakoi.github.io/",
    logo: "https://tokotehtjapduakoi.github.io/assets/logo.png",
    image: "https://tokotehtjapduakoi.github.io/assets/og-image.jpg",
    servesCuisine: ["Teh tarik", "Kopi tarik", "Bagel", "Wrap"],
    telephone: "+" + bersihNomor(W.nomor),
    sameAs: [links.instagram, links.tiktok].filter(Boolean),
    address: cabang.filter(function (c) { return String(c.status).toLowerCase() !== "segera"; }).map(function (c) {
      return { "@type": "PostalAddress", streetAddress: c.nama + (c.alamat ? ", " + c.alamat : ""), addressLocality: c.kota, addressCountry: "ID" };
    })
  };
  var s = document.createElement("script");
  s.type = "application/ld+json";
  s.textContent = JSON.stringify(ld);
  document.head.appendChild(s);
})();
