import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, afterEach, before, test } from "node:test";
import pg from "pg";
import { ambilFoto, bukaHalaman, buatFoto, chromium, isiKeranjang, jalankanServer, siapJual, siapkanDb } from "./bantu.mjs";

let db, server, browser, foto, sql;
before(async () => {
  db = await siapkanDb();
  server = await jalankanServer(db.conninfo);
  browser = await chromium.launch();
  sql = new pg.Client({ connectionString: db.conninfo });
  await sql.connect();
  foto = buatFoto();
});
afterEach(async () => { // server tiruan dipakai bersama: kembalikan normal walau uji gagal
  await uji("/__uji/offline", { on: false });
  await uji("/__uji/putus-setelah-rpc", { fn: "pos_checkout", kali: 0 });
  await uji("/__uji/lambat", { fn: "pos_checkout", ms: 0, kali: 0 });
});
after(async () => {
  await sql?.end();
  await browser?.close();
  await server?.tutup();
  await db?.tutup();
});

const uji = (jalur, isi) => fetch(server.url + jalur, { method: "POST", body: JSON.stringify(isi) });
// Putus total: server tiruan menolak API dan browser offline.
async function internet(context, ada) {
  await uji("/__uji/offline", { on: !ada });
  await context.setOffline(!ada);
}
const jumlahNota = async () => (await sql.query("select count(*)::int as n from pos_notas")).rows[0].n;
async function tunggu(cek, pesan, ms = 15000) {
  const mulai = Date.now();
  while (Date.now() - mulai < ms) { if (await cek()) return; await new Promise((r) => setTimeout(r, 200)); }
  assert.fail("waktu habis: " + pesan);
}
const sha = (kode) => createHash("sha256").update(kode.replace("-", "")).digest("hex");
const swSiap = (page) => page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
async function jualQris(page) {
  await isiKeranjang(page);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  await ambilFoto(page, foto);
  await page.getByRole("button", { name: "Lunas" }).click();
}
const bilah = (page) => page.locator("#bilah");

test("jual saat offline lalu terkirim", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await page.clock.install();
  await siapJual(page, buka, server);
  await bilah(page).getByText("Online").waitFor();
  const sebelum = await jumlahNota();
  await internet(context, false);
  await bilah(page).getByText("Offline").waitFor();
  await isiKeranjang(page);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  // voucher TK- tidak bisa dicek saat offline
  assert.equal(await page.getByLabel("Voucher TK- (opsional)").isDisabled(), true);
  await page.getByText("Voucher TK- tidak bisa dipakai saat offline").waitFor();
  await page.getByRole("button", { name: "QRIS" }).click();
  await ambilFoto(page, foto);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.getByText("Tersimpan di HP, akan terkirim otomatis").waitFor();
  assert.equal(await page.locator(".qr svg").count(), 1);
  const kode = (await page.locator("#kode-klaim").innerText()).trim();
  assert.match(kode, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  await bilah(page).getByText("Offline · 1 nota menunggu").waitFor();
  assert.equal(await jumlahNota(), sebelum, "belum ada nota di server");

  await internet(context, true);
  await page.clock.fastForward("00:35");
  await tunggu(async () => (await jumlahNota()) === sebelum + 1, "nota terkirim");
  const r = await sql.query(`select n.offline, r.code_hash from pos_notas n join kk_receipts r on r.pos_nota_id = n.id
    order by n.received_at desc limit 1`);
  assert.deepEqual(r.rows[0], { offline: true, code_hash: sha(kode) });
  await bilah(page).getByText("Online", { exact: true }).waitFor();
  // layar Selesai ikut diperbarui dengan nomor nota dari server
  await page.locator(".selesai .kode", { hasText: /^K\d{6}-\d{3}$/ }).waitFor();
  await context.close();
});

test("antrean bertahan setelah reload", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await swSiap(page);
  const sebelum = await jumlahNota();
  await internet(context, false);
  await jualQris(page);
  await page.getByText("Tersimpan di HP, akan terkirim otomatis").waitFor();
  await page.reload();
  await bilah(page).getByText("Offline · 1 nota menunggu").waitFor();
  await page.getByRole("button", { name: "Teh Tarik" }).waitFor();
  assert.equal(await jumlahNota(), sebelum);
  await internet(context, true);
  await tunggu(async () => (await jumlahNota()) === sebelum + 1, "nota terkirim setelah online");
  await bilah(page).getByText("Online", { exact: true }).waitFor();
  await context.close();
});

test("kirim ulang tidak dobel", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await page.clock.install();
  await siapJual(page, buka, server);
  const sebelum = await jumlahNota();
  // pos_checkout tersimpan di server, tetapi jawabannya tidak sampai ke HP
  await uji("/__uji/putus-setelah-rpc", { fn: "pos_checkout", kali: 1 });
  await jualQris(page);
  await page.getByText("Tersimpan di HP, akan terkirim otomatis").waitFor();
  const kode = (await page.locator("#kode-klaim").innerText()).trim();
  assert.equal(await jumlahNota(), sebelum + 1, "nota sudah tersimpan di server");
  await page.clock.fastForward("00:35");
  await tunggu(() => page.evaluate(() => Antrean.jumlah().then((n) => n === 0)), "antrean kosong");
  assert.equal(await jumlahNota(), sebelum + 1, "tidak ada nota ganda");
  const r = await sql.query(`select r.code_hash from pos_notas n join kk_receipts r on r.pos_nota_id = n.id
    order by n.received_at desc limit 1`);
  assert.equal(r.rows[0].code_hash, sha(kode), "kode di layar = kode yang disimpan server");
  await context.close();
});

test("logout ditolak saat antrean ada", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await internet(context, false);
  await jualQris(page);
  await page.getByText("Tersimpan di HP, akan terkirim otomatis").waitFor();
  await page.getByRole("button", { name: "Keluar" }).click();
  await page.getByText("Masih ada 1 nota belum terkirim. Sambungkan internet dulu.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Masuk" }).count(), 0);
  await context.close();
});

test("halaman terbuka tanpa internet", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await swSiap(page);
  await internet(context, false);
  await page.reload();
  await page.getByRole("button", { name: "Teh Tarik" }).waitFor();
  await bilah(page).getByText("Offline").waitFor();
  await context.close();
});

// Item antrean buatan uji (uid = kasir pemilik nota; bawaan: kasir yang login; folder foto bawaan = uid).
const simpanItem = (page, { uid = null, payload = {}, folder = null, dibuat = 1 } = {}) => page.evaluate(({ uid, payload, folder, dibuat }) => {
  const u = uid || JSON.parse(localStorage.getItem("kasir-auth")).user.id, id = crypto.randomUUID();
  return Antrean.simpan({ id, uid: u, payload: { id, ...payload }, foto: new Blob(["x"], { type: "image/jpeg" }),
    fotoPath: `${folder || u}/${id}.jpg`, dibuat }).then(() => id);
}, { uid, payload, folder, dibuat });

test("nota ditolak tidak menahan antrean dan tidak menahan logout", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  const sebelum = await jumlahNota();
  await internet(context, false);
  // nota lama di depan antrean: storage menolak fotonya (4xx, bukan masalah jaringan) dan
  // nota lain yang ditolak pos_checkout (P0001)
  await simpanItem(page, { folder: "bukan-folder-kasir", dibuat: 1 });
  await simpanItem(page, { payload: { id: "bukan-uuid" }, dibuat: 2 });
  await jualQris(page);
  await page.getByText("Tersimpan di HP, akan terkirim otomatis").waitFor();
  await bilah(page).getByText("Offline · 3 nota menunggu").waitFor();
  await internet(context, true);
  await tunggu(async () => (await jumlahNota()) === sebelum + 1, "nota ketiga tetap terkirim");
  await bilah(page).getByText(/ID nota tidak valid/).waitFor();
  assert.equal(await bilah(page).getByRole("link", { name: "Laporkan ke pemilik" }).count(), 2);
  assert.deepEqual(await page.evaluate(async () => [await Antrean.jumlah(), await Antrean.jumlahError()]), [0, 2]);
  await page.getByRole("button", { name: "Keluar" }).click();
  await page.getByRole("button", { name: "Masuk" }).waitFor();
  assert.equal(await page.evaluate(() => Antrean.jumlahError()), 2, "nota error tetap tersimpan setelah logout");
  await context.close();
});

test("nota kasir lain tidak dikirim dan tidak menahan logout", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  const lain = (await sql.query("select id from auth.users where email = 'budi@uji.id'")).rows[0].id;
  await simpanItem(page, { uid: lain, payload: { offline: true }, dibuat: 1 });
  const sebelum = await jumlahNota();
  await jualQris(page);
  await page.locator(".selesai .kode", { hasText: /^K\d{6}-\d{3}$/ }).waitFor();
  await bilah(page).getByText("1 nota milik kasir lain menunggu", { exact: false }).waitFor();
  assert.equal(await jumlahNota(), sebelum + 1);
  const sisa = await page.evaluate(() => Antrean.daftar().then((a) => a.map((it) => [it.uid, it.error || null])));
  assert.deepEqual(sisa, [[lain, null]], "nota kasir lain tidak dicoba");
  assert.equal(await bilah(page).getByText(/nota menunggu$/).count(), 0, "bukan nota kasir ini");
  await page.getByRole("button", { name: "Keluar" }).click();
  await page.getByRole("button", { name: "Masuk" }).waitFor();
  await context.close();
});

test("Lunas tidak menunggu kiriman yang lambat", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  const sebelum = await jumlahNota();
  await uji("/__uji/lambat", { fn: "pos_checkout", ms: 12000, kali: 1 });
  const mulai = Date.now();
  await jualQris(page);
  await page.getByText("Tersimpan di HP, akan terkirim otomatis").waitFor({ timeout: 11000 });
  assert.ok(Date.now() - mulai < 11000, "layar Selesai tampil sebelum server menjawab");
  assert.equal(await jumlahNota(), sebelum);
  // kiriman yang sama tetap jalan di belakang, lalu layar Selesai menampilkan nomor nota
  await page.locator(".selesai .kode", { hasText: /^K\d{6}-\d{3}$/ }).waitFor({ timeout: 15000 });
  assert.equal(await jumlahNota(), sebelum + 1);
  assert.equal(await page.evaluate(() => Antrean.jumlah()), 0);
  await context.close();
});
