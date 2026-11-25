/* Pemutar musik Toko Teh Tjap Dua Koi.
   Default: musik orisinal "Teh Tarik Sore" yang dimainkan langsung oleh browser
   (Web Audio, tanpa file, jadi ringan). Kalau config.js -> musik.file diisi,
   file MP3 itu yang diputar. Musik hanya mulai setelah pengunjung mengetuk tombol. */
(function () {
  "use strict";
  var C = (window.KOI_CONFIG && window.KOI_CONFIG.musik) || {};
  var wadah = document.getElementById("musik");
  if (!wadah || C.tampil === false) return;
  var tombol = wadah.querySelector("button");
  var teks = wadah.querySelector(".musik__teks");
  var judul = C.judul || "Teh Tarik Sore";
  wadah.hidden = false;
  tombol.title = judul;

  var nyala = false, dijedaOtomatis = false, mesin = null;

  function setTampilan(on) {
    tombol.setAttribute("aria-pressed", on ? "true" : "false");
    tombol.setAttribute("aria-label", on ? "Jeda musik " + judul : "Putar musik " + judul);
    wadah.classList.toggle("is-nyala", on);
    teks.textContent = on ? "Jeda musik" : "Putar musik";
  }

  /* ---------- Mode file MP3 milik sendiri ---------- */
  function mesinFile(src) {
    var a = new Audio(src);
    a.loop = true; a.preload = "none"; a.volume = 0.7;
    return {
      main: function () { return a.play(); },
      jeda: function () { a.pause(); }
    };
  }

  /* ---------- Mode musik orisinal (Web Audio) ---------- */
  function mesinSintesis() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    var ctx = new AC();
    var BPM = 76, DELAPAN = 60 / BPM / 2, SWING = 0.12 * DELAPAN;

    // Rantai utama: master -> kompresor -> lowpass hangat -> speaker
    var master = ctx.createGain(); master.gain.value = 0;
    var komp = ctx.createDynamicsCompressor();
    komp.threshold.value = -18; komp.ratio.value = 3;
    var hangat = ctx.createBiquadFilter(); hangat.type = "lowpass"; hangat.frequency.value = 5200;
    master.connect(komp); komp.connect(hangat); hangat.connect(ctx.destination);

    // Gema ruangan sederhana
    var gema = ctx.createConvolver();
    var panjang = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, panjang, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < panjang; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / panjang, 3);
    }
    gema.buffer = ir;
    var gemaGain = ctx.createGain(); gemaGain.gain.value = 0.28;
    gema.connect(gemaGain); gemaGain.connect(master);

    // Derau putih untuk perkusi & kresek piringan hitam
    var derau = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate), dd = derau.getChannelData(0);
    for (i = 0; i < dd.length; i++) dd[i] = Math.random() * 2 - 1;

    function hz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

    function petik(t, m, lama, vol) {
      var o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = "triangle"; o2.type = "sine";
      o1.frequency.value = hz(m); o2.frequency.value = hz(m) * 2; o2.detune.value = 4;
      var g2 = ctx.createGain(); g2.gain.value = 0.35;
      var f = ctx.createBiquadFilter(); f.type = "lowpass";
      f.frequency.setValueAtTime(4200, t); f.frequency.exponentialRampToValueAtTime(1100, t + 0.5);
      var g = ctx.createGain();
      var ekor = Math.max(0.9, lama * 1.4);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0008, t + ekor);
      o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(g);
      g.connect(master); g.connect(gema);
      o1.start(t); o2.start(t); o1.stop(t + ekor + 0.05); o2.stop(t + ekor + 0.05);
    }
    function pad(t, nada, lama) {
      var g = ctx.createGain(), f = ctx.createBiquadFilter();
      f.type = "lowpass"; f.frequency.value = 900;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045, t + 0.8);
      g.gain.linearRampToValueAtTime(0.0001, t + lama + 0.4);
      f.connect(g); g.connect(master); g.connect(gema);
      nada.forEach(function (m) {
        var o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = hz(m);
        o.connect(f); o.start(t); o.stop(t + lama + 0.5);
      });
    }
    function bass(t, m) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = hz(m);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.32, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 1);
    }
    function kayu(t, vol) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(1050, t); o.frequency.exponentialRampToValueAtTime(700, t + 0.05);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.08);
    }
    function kocok(t, vol) {
      var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = derau; f.type = "highpass"; f.frequency.value = 6500;
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.045);
      s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 0.5, 0.06);
    }
    // Kresek halus ala piringan hitam (suasana tempo dulu)
    var kresek = ctx.createBuffer(1, ctx.sampleRate * 3, ctx.sampleRate), kk = kresek.getChannelData(0);
    for (i = 0; i < kk.length; i++) kk[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) : (Math.random() * 2 - 1) * 0.012;
    var sumberKresek = ctx.createBufferSource(); sumberKresek.buffer = kresek; sumberKresek.loop = true;
    var gKresek = ctx.createGain(); gKresek.gain.value = 0.22;
    var fKresek = ctx.createBiquadFilter(); fKresek.type = "bandpass"; fKresek.frequency.value = 2500;
    sumberKresek.connect(fKresek); fKresek.connect(gKresek); gKresek.connect(master); sumberKresek.start();

    // Akor: G, Em, C, D (bass, pad)
    var AKOR = [
      { b: 43, p: [55, 59, 62] }, { b: 40, p: [52, 55, 59] },
      { b: 36, p: [48, 52, 55] }, { b: 38, p: [50, 54, 57] }
    ];
    // Melodi pentatonik G (8 birama x 8 ketukan seperdelapan): [langkah, nada, panjang]
    var MELODI = [
      [[0, 74, 2], [2, 71, 1], [3, 69, 1], [4, 67, 2], [6, 69, 1], [7, 71, 1]],
      [[0, 71, 3], [3, 74, 1], [4, 76, 2], [6, 74, 2]],
      [[0, 76, 1], [1, 74, 1], [2, 71, 2], [4, 69, 2], [6, 67, 2]],
      [[0, 69, 4], [4, 71, 1], [5, 69, 1], [6, 64, 2]],
      [[0, 67, 1], [1, 69, 1], [2, 71, 2], [4, 74, 2], [6, 76, 1], [7, 74, 1]],
      [[0, 71, 2], [2, 69, 1], [3, 67, 1], [4, 64, 4]],
      [[0, 67, 2], [2, 69, 2], [4, 71, 1], [5, 74, 1], [6, 71, 2]],
      [[0, 69, 3], [3, 67, 1], [4, 69, 2]]
    ];
    var ARPEG = [0, 2, 1, 2, 0, 2, 1, 2]; // urutan nada akor saat bagian selingan

    var langkah = 0, waktuBerikut = 0, timer = null;
    function jadwal(n, t) {
      var birama = Math.floor(n / 8), s = n % 8;
      var bagian = Math.floor(birama / 8) % 2;  // 0 = melodi, 1 = selingan arpeggio
      var b8 = birama % 8, akor = AKOR[b8 % 4];
      var tt = t + (s % 2 ? SWING : 0);
      if (s === 0) { bass(tt, akor.b); pad(tt, akor.p, DELAPAN * 8); }
      if (s === 4) bass(tt, akor.b + 7);
      if (s === 2 || s === 6) kayu(tt, 0.06);
      if (s % 2) kocok(tt, 0.025);
      if (bagian === 0) {
        MELODI[b8].forEach(function (x) { if (x[0] === s) petik(tt, x[1], x[2] * DELAPAN, 0.2); });
      } else if (s % 2 === 0 || s === 7) {
        petik(tt, akor.p[ARPEG[s]] + 12, DELAPAN * 2, 0.11);
      }
    }
    function penjadwal() {
      while (waktuBerikut < ctx.currentTime + 0.15) {
        jadwal(langkah, waktuBerikut);
        waktuBerikut += DELAPAN; langkah++;
      }
    }
    return {
      main: function () {
        return ctx.resume().then(function () {
          if (!timer) {
            if (waktuBerikut < ctx.currentTime) waktuBerikut = ctx.currentTime + 0.05;
            timer = setInterval(penjadwal, 25);
          }
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
          master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 1.2);
        });
      },
      jeda: function () {
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
        setTimeout(function () {
          if (!nyala) { clearInterval(timer); timer = null; ctx.suspend(); }
        }, 450);
      }
    };
  }

  function siapkan() {
    if (mesin) return mesin;
    var file = String(C.file || "").trim();
    mesin = file ? mesinFile(file) : mesinSintesis();
    return mesin;
  }

  function main() {
    var m = siapkan();
    if (!m) { teks.textContent = "Musik tidak didukung"; tombol.disabled = true; return; }
    nyala = true; setTampilan(true);
    var p = m.main();
    if (p && p.catch) p.catch(function () { nyala = false; setTampilan(false); });
  }
  function jeda() {
    nyala = false; setTampilan(false);
    if (mesin) mesin.jeda();
  }

  tombol.addEventListener("click", function () { nyala ? jeda() : main(); });

  // Jeda saat pindah aplikasi/tab, lanjut lagi saat kembali
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && nyala) { dijedaOtomatis = true; jeda(); }
    else if (!document.hidden && dijedaOtomatis) { dijedaOtomatis = false; main(); }
  });

  setTampilan(false);
})();
