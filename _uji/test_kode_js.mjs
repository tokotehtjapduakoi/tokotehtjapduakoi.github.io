import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

globalThis.KASIR_CONFIG = { kolamUrl: "https://tokotehtjapduakoi.github.io/kolam/", waNomor: "6281345306571" };
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

test("urlKlaim, teksNotaToko, linkWaToko", () => {
  assert.equal(K.urlKlaim("ABCDE23456"), "https://tokotehtjapduakoi.github.io/kolam/?kode=ABCDE-23456");
  const lines = [{ qty: 2, item: "Teh Tarik", variant: "14 oz", price: 15000 }, { qty: 1, item: "Milo Tarik", variant: "14 oz", price: 17000 }];
  assert.equal(K.teksNotaToko({ no: "K261125-001", lines, total: 47000, kode: "ABCDE23456" }),
    "Halo Tjap Dua Koi! Nota saya K261125-001 · 2× Teh Tarik 14 oz, 1× Milo Tarik 14 oz · Rp47.000.\nTarik kartu koi: https://tokotehtjapduakoi.github.io/kolam/?kode=ABCDE-23456");
  assert.match(K.teksNotaToko({ no: null, lines, total: 47000, kode: "ABCDE23456" }), /^Halo Tjap Dua Koi! Nota saya nota baru · /);
  assert.equal(K.teksNotaToko({ no: "K1", lines: lines.slice(0, 1), total: 0, kode: "ABCDE23456" }),
    "Halo Tjap Dua Koi! Nota saya K1 · 2× Teh Tarik 14 oz · Rp0.");
  assert.equal(K.linkWaToko("a b\nc"), "https://wa.me/6281345306571?text=a%20b%0Ac");
});
