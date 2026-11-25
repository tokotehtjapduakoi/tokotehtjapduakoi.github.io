import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

globalThis.KASIR_CONFIG = { kolamUrl: "https://tokotehtjapduakoi.github.io/kolam/" };
const K = createRequire(import.meta.url)("../kasir/kode.js");

test("buat: 10 karakter alfabet, tidak ada duplikat", () => {
  const semua = new Set();
  for (let i = 0; i < 10000; i++) {
    const k = K.buat();
    assert.match(k, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
    semua.add(k);
  }
  assert.equal(semua.size, 10000);
});

test("buat: sebaran rata (tiap huruf muncul)", () => {
  const hitung = {};
  for (let i = 0; i < 20000; i++) for (const c of K.buat()) hitung[c] = (hitung[c] || 0) + 1;
  assert.equal(Object.keys(hitung).length, 31);
  const rata = 200000 / 31;
  for (const n of Object.values(hitung)) assert.ok(Math.abs(n - rata) < rata * 0.1, "sebaran miring");
});

test("normal dan tampil", () => {
  assert.equal(K.normal(" abcde-23456 "), "ABCDE23456");
  assert.equal(K.tampil("ABCDE23456"), "ABCDE-23456");
  assert.equal(K.tampil("abcde-23456"), "ABCDE-23456");
});

test("urlKlaim, teksWa, linkWa", () => {
  assert.equal(K.urlKlaim("ABCDE23456"), "https://tokotehtjapduakoi.github.io/kolam/?kode=ABCDE-23456");
  const t = K.teksWa({ no: "K261125-001", lines: [{ qty: 2, item: "Teh Tarik", variant: "14 oz", price: 15000 }],
    total: 30000, method: "Tunai", kode: "ABCDE23456", tanggal: new Date("2026-11-25T06:30:00Z") });
  assert.match(t, /\?kode=ABCDE-23456/);
  assert.match(t, /^Toko Teh Tjap Dua Koi\nNota K261125-001 · 25 Nov 2026 14:30\n2× Teh Tarik 14 oz  Rp30\.000\nTotal Rp30\.000 \(Tunai\)\n\nTarik kartu koi-mu di Kolam Koi:\n/);
  assert.match(t, /Kode: ABCDE-23456 \(berlaku 7 hari\)\n\nTerima kasih, sampai ketemu lagi!$/);
  const l = K.linkWa("6281200000001", "a b\nc");
  assert.equal(l, "https://wa.me/6281200000001?text=a%20b%0Ac");
});
