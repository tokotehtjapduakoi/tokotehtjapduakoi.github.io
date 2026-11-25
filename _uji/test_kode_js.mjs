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

test("buat: byte >= 248 dibuang (rejection sampling), tidak dipetakan", () => {
  const desk = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  const asli = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  const antrean = [[248, 255, 250, 249, 251, 252, 253, 254, 248, 255, 250, 249, 251, 252, 253, 254], // semua dibuang
    [0, 30, 31, 61, 62, 247, 247, 1, 2, 3, 4, 5, 6, 7, 8, 9]]; // 247 % 31 = 30 -> '9'
  let panggilan = 0;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: (b) => {
    panggilan++;
    const isi = antrean.shift() || Array.from(asli(new Uint8Array(16)));
    b.set(isi); return b;
  } } });
  try {
    const k = K.buat();
    assert.equal(panggilan, 2, "blok pertama (semua >= 248) harus dibuang seluruhnya");
    // 0->A 30->9 31->A 61->9 62->A 247->9 247->9 1->B 2->C 3->D
    assert.equal(k, "A9A9A99BCD");
  } finally {
    Object.defineProperty(globalThis, "crypto", desk);
  }
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
