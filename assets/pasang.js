/* Tawaran "Pasang aplikasi" (ikon di layar utama HP).
   Android/Chrome: tombol Pasang (prompt bawaan browser).
   iPhone/iPad Safari: petunjuk Bagikan -> Tambah ke Layar Utama.
   Browser di dalam Instagram/TikTok/Facebook: ajakan buka di Chrome/Safari.
   Tidak tampil kalau sudah terpasang, atau 7 hari setelah ketuk "Nanti".
   Pemakaian: <script src=".../assets/pasang.js" data-nama="Kolam Koi" defer></script> */
(function () {
  "use strict";
  var skrip = document.currentScript;
  var nama = (skrip && skrip.getAttribute("data-nama")) || "Toko Teh";
  var KUNCI = "pasang-nanti-" + location.pathname;
  var ua = navigator.userAgent || "";
  var terpasang = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  if (terpasang) return;
  try { var t = Number(localStorage.getItem(KUNCI) || 0); if (t && Date.now() - t < 7 * 864e5) return; } catch (e) {}

  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var dalamApp = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|BytedanceWebview|Line\//i.test(ua);
  var promptAsli = null;

  var CSS = "position:fixed;left:12px;right:12px;top:calc(10px + env(safe-area-inset-top));z-index:9999;max-width:520px;margin:0 auto;" +
    "display:flex;gap:10px;align-items:center;padding:10px 12px;background:#F6EFDF;color:#1F2A25;border:3px solid #1F2A25;" +
    "border-radius:16px;box-shadow:4px 4px 0 #1F2A25;font:500 14px/1.35 Inter,system-ui,sans-serif";
  var BTN = "min-height:44px;padding:8px 14px;border:2.5px solid #1F2A25;border-radius:12px;font:700 14px Inter,system-ui,sans-serif;cursor:pointer";

  function tutup(el, nanti) {
    if (nanti) { try { localStorage.setItem(KUNCI, String(Date.now())); } catch (e) {} }
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }
  function ikon() {
    var l = document.querySelector('link[rel="apple-touch-icon"]');
    return l ? '<img src="' + l.href + '" alt="" width="40" height="40" style="flex:none;border-radius:10px;border:2px solid #1F2A25">' : "";
  }
  function tampil(isi, tombol) {
    if (document.getElementById("pasang-app")) return;
    var el = document.createElement("div");
    el.id = "pasang-app"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Pasang aplikasi " + nama);
    el.style.cssText = CSS;
    el.innerHTML = ikon() + '<div style="flex:1;min-width:0">' + isi + "</div>" + (tombol || "") +
      '<button type="button" data-nanti aria-label="Tutup" style="' + BTN + ';background:transparent;border-color:transparent;padding:8px;font-size:20px;line-height:1">&times;</button>';
    document.body.appendChild(el);
    el.querySelector("[data-nanti]").onclick = function () { tutup(el, true); };
    var p = el.querySelector("[data-pasang]");
    if (p) p.onclick = function () {
      if (!promptAsli) return;
      promptAsli.prompt();
      promptAsli.userChoice.then(function (r) { tutup(el, r.outcome !== "accepted"); promptAsli = null; });
    };
  }

  var BAGIKAN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="ikon Bagikan" style="vertical-align:-3px"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); promptAsli = e;
    tampil("<b>Pasang " + nama + "</b><br>Ikon di layar HP, sekali ketuk langsung terbuka.",
      '<button type="button" data-pasang style="' + BTN + ';background:#D9822B;color:#1F2A25">Pasang</button>');
  });
  window.addEventListener("appinstalled", function () { tutup(document.getElementById("pasang-app"), false); });

  setTimeout(function () {
    if (promptAsli || document.getElementById("pasang-app")) return;
    if (dalamApp) {
      tampil("<b>Mau pasang " + nama + "?</b><br>Buka halaman ini di " + (ios ? "Safari" : "Chrome") +
        " dulu: ketuk menu <b>&middot;&middot;&middot;</b> lalu <b>Buka di browser</b>.");
    } else if (ios) {
      tampil("<b>Pasang " + nama + "</b><br>Ketuk " + BAGIKAN + " <b>Bagikan</b>, lalu <b>Tambah ke Layar Utama</b>.");
    }
  }, 2500);
})();
