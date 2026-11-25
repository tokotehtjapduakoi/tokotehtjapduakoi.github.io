import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { ambilFoto, bukaHalaman, buatFoto, chromium, isiKeranjang, jalankanServer, masuk, rpcSebagai, siapJual, siapkanDb } from "./bantu.mjs";

// Tiap uji punya database + server sendiri (shift hanya boleh satu yang terbuka).
async function lingkungan(isi) {
  const db = await siapkanDb();
  const server = await jalankanServer(db.conninfo);
  const browser = await chromium.launch();
  const sql = new pg.Client({ connectionString: db.conninfo });
  await sql.connect();
  const foto = buatFoto();
  try { await isi({ db, server, browser, sql, foto }); }
  finally { await sql.end(); await browser.close(); await server.tutup(); await db.tutup(); }
}
// Masuk + HP disetujui pemilik, tanpa membuka shift.
async function masukSetuju(page, buka, server, email) {
  await buka();
  await masuk(page, email);
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  const device = await page.evaluate(() => localStorage.getItem("kasir.device"));
  await rpcSebagai(server, "pemilik@uji.id", "pos_device_decide", { p_device: device, p_approve: true });
  await page.getByRole("button", { name: "Cek lagi" }).click();
  return device;
}
async function jualTunai(page, foto, qty = 2) {
  await isiKeranjang(page, qty);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "Tunai" }).click();
  await page.getByRole("button", { name: "Uang pas" }).click();
  await ambilFoto(page, foto);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".selesai .kode", { hasText: /^K\d{6}-\d{3}$/ }).waitFor();
}
async function fotoLaci(page, foto) {
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /foto laci/ }).click()]);
  await fc.setFiles(foto);
  await page.getByAltText("Pratinjau foto laci").waitFor();
}
const tab = (page, nama) => page.locator("#tab").getByRole("button", { name: nama, exact: true });

test("buka-jual-serah terima-terima", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const a = await bukaHalaman(browser, server);
  const deviceOcha = await masukSetuju(a.page, a.buka, server, "ocha@uji.id");
  await a.page.getByRole("heading", { name: "Buka toko" }).waitFor();
  assert.equal(await a.page.getByRole("button", { name: "Buka toko" }).isDisabled(), true, "modal wajib diisi");
  await a.page.getByLabel("Modal awal di laci (Rp)").fill("100000");
  await a.page.getByRole("button", { name: "Buka toko" }).click();
  await a.page.getByRole("button", { name: "Teh Tarik" }).waitFor();
  assert.deepEqual((await sql.query("select cash_start from pos_shifts")).rows, [{ cash_start: 100000 }]);
  assert.equal(await tab(a.page, "Jual").getAttribute("aria-current"), "page");
  await jualTunai(a.page, foto);

  // Kas: hitungan + foto wajib
  await tab(a.page, "Kas").click();
  await a.page.getByRole("button", { name: "Serah terima ke kasir berikutnya" }).click();
  await a.page.getByLabel("Uang di laci (Rp)").fill("130000");
  assert.equal(await a.page.getByRole("button", { name: "Serahkan laci" }).isDisabled(), true, "foto laci wajib");
  await fotoLaci(a.page, foto);
  await a.page.getByRole("button", { name: "Serahkan laci" }).click();
  await a.page.getByRole("heading", { name: "Laci diserahkan" }).waitFor();
  assert.equal(await a.page.locator("#tab").isHidden(), true, "tab bawah hilang tanpa shift");
  const s = await sql.query("select closed_at is not null as tutup, handover, cash_counted, close_photo from pos_shifts");
  assert.equal(s.rowCount, 1);
  assert.deepEqual([s.rows[0].tutup, s.rows[0].handover, s.rows[0].cash_counted], [true, true, 130000]);
  assert.match(s.rows[0].close_photo, /^[0-9a-f-]{36}\/laci-\d+-[0-9a-f]{8}\.jpg$/);
  const f = await sql.query("select (metadata->>'size')::int as n from storage.objects where name = $1", [s.rows[0].close_photo]);
  assert.ok(f.rows[0].n > 1000 && f.rows[0].n <= 40 * 1024);
  // muat ulang: kasir yang menyerahkan melihat kartu menunggu, bukan form terima
  await a.page.reload();
  await a.page.getByRole("heading", { name: "Laci sudah diserahkan" }).waitFor();
  assert.equal(await a.page.getByRole("button", { name: "Terima laci" }).count(), 0);
  await a.page.getByRole("button", { name: "Keluar" }).click();
  await a.page.getByRole("button", { name: "Masuk" }).waitFor();
  await a.context.close();

  // Budi: HP sendiri disetujui, menghitung buta, melihat selisih
  const b = await bukaHalaman(browser, server);
  await masukSetuju(b.page, b.buka, server, "budi@uji.id");
  await b.page.getByRole("heading", { name: "Terima laci dari Ocha" }).waitFor();
  assert.equal(await b.page.getByText(/130\.000|130000/).count(), 0, "hitungan kasir sebelumnya tidak ditampilkan");
  assert.equal(await b.page.getByRole("button", { name: "Teh Tarik" }).count(), 0);
  await b.page.getByLabel("Uang di laci (Rp)").fill("125000");
  await b.page.getByRole("button", { name: "Terima laci" }).click();
  await b.page.getByText("Selisih −Rp5.000").waitFor();
  await b.page.getByRole("button", { name: "Mulai jual" }).click();
  await b.page.getByRole("button", { name: "Teh Tarik" }).waitFor();
  const baru = await sql.query("select cash_start, received_from is not null as dari from pos_shifts where closed_at is null");
  assert.deepEqual(baru.rows, [{ cash_start: 125000, dari: true }]);
  await b.context.close();
  void deviceOcha;
}));

test("tutup toko tanpa serah terima, lalu buka lagi", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await tab(page, "Kas").click();
  await page.getByRole("button", { name: "Tutup toko" }).click();
  await page.getByLabel("Uang di laci (Rp)").fill("100000");
  await fotoLaci(page, foto);
  await page.getByRole("button", { name: "Tutup toko sekarang" }).click();
  await page.getByRole("heading", { name: "Toko ditutup" }).waitFor();
  assert.deepEqual((await sql.query("select handover from pos_shifts")).rows, [{ handover: false }]);
  await page.getByRole("button", { name: "Buka toko lagi" }).click();
  await page.getByRole("heading", { name: "Buka toko" }).waitFor();
  await context.close();
}));

test("ajukan batal", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await jualTunai(page, foto);
  await tab(page, "Nota").click();
  await page.locator(".nota-baris", { hasText: /K\d{6}-001/ }).click();
  const img = page.getByAltText("Foto bukti nota");
  await img.waitFor();
  await page.waitForFunction(() => { const i = document.querySelector(".foto-nota"); return i && i.complete && i.naturalWidth > 0; });
  assert.equal(await page.locator("#status-nota").innerText(), "Lunas");
  await page.getByRole("button", { name: "Ajukan batal" }).click();
  const kirim = page.getByRole("button", { name: "Kirim pengajuan" });
  assert.equal(await kirim.isDisabled(), true, "belum memilih alasan");
  await page.getByRole("button", { name: "Lainnya" }).click();
  await page.getByLabel(/Tulis alasan/).fill("abc");
  assert.equal(await kirim.isDisabled(), true, "Lainnya minimal 5 huruf");
  await page.getByLabel(/Tulis alasan/).fill("pelanggan salah pesan");
  await kirim.click();
  await page.locator("#status-nota", { hasText: "Menunggu persetujuan" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /Ajukan batal|hapus|batalkan/i }).count(), 0);
  const q = await sql.query("select reason, decided_at from pos_void_requests");
  assert.deepEqual(q.rows, [{ reason: "pelanggan salah pesan", decided_at: null }]);
  // alasan siap pakai
  await page.getByRole("button", { name: "← Daftar" }).click();
  await page.locator(".nota-baris .lencana", { hasText: "Menunggu persetujuan" }).waitFor();
  await context.close();
}));

test("alasan siap pakai: Salah input", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await jualTunai(page, foto, 1);
  await tab(page, "Nota").click();
  await page.locator(".nota-baris").first().click();
  await page.getByRole("button", { name: "Ajukan batal" }).click();
  await page.getByRole("button", { name: "Salah input" }).click();
  await page.getByRole("button", { name: "Kirim pengajuan" }).click();
  await page.locator("#status-nota", { hasText: "Menunggu persetujuan" }).waitFor();
  assert.deepEqual((await sql.query("select reason from pos_void_requests")).rows, [{ reason: "Salah input" }]);
  await context.close();
}));

// Item antrean buatan uji.
const simpanItem = (page, { error = null, payload = {} } = {}) => page.evaluate(({ error, payload }) => {
  const uid = JSON.parse(localStorage.getItem("kasir-auth")).user.id, id = crypto.randomUUID();
  return Antrean.simpan({ id, uid, payload: { id, total: 15000, client_at: new Date().toISOString(), lines: [], ...payload },
    foto: new Blob(["x"], { type: "image/jpeg" }), fotoPath: `${uid}/${id}.jpg`, dibuat: Date.now(), ...(error ? { error } : {}) }).then(() => id);
}, { error, payload });

test("nota ditolak di antrean: laporkan dulu, baru hapus (dua ketukan)", () => lingkungan(async ({ server, browser }) => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  const id = await simpanItem(page, { error: "ID nota tidak valid" });
  await tab(page, "Nota").click();
  await page.locator(".nota-baris", { hasText: "Ditolak server" }).click();
  await page.locator("#app").getByText("Ditolak server: ID nota tidak valid").waitFor();
  const hapus = page.getByRole("button", { name: "Hapus dari HP" });
  assert.equal(await hapus.isDisabled(), true, "belum dilaporkan");
  const lapor = page.locator("#app").getByRole("link", { name: "Laporkan ke pemilik" });
  const href = await lapor.getAttribute("href");
  assert.match(href, /^https:\/\/wa\.me\/6281345306571\?text=/);
  assert.ok(decodeURIComponent(href).includes(id));
  await page.context().route("https://wa.me/**", (r) => r.fulfill({ body: "ok" }));
  await lapor.click();
  await page.waitForFunction(() => !document.querySelector("#hapus-hp").disabled);
  await hapus.click();
  await page.getByRole("button", { name: /Yakin/ }).waitFor();
  assert.equal(await page.evaluate(() => Antrean.jumlahError()), 1, "ketukan pertama belum menghapus");
  await page.getByRole("button", { name: /Yakin/ }).click();
  await page.getByText("Belum ada nota di shift ini.").waitFor();
  assert.equal(await page.evaluate(() => Antrean.jumlahError()), 0);
  await context.close();
}));

test("serah terima dan tutup toko ditahan selama ada nota belum terkirim", () => lingkungan(async ({ server, browser }) => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await simpanItem(page, { payload: { id: "bukan-uuid" } });
  await tab(page, "Kas").click();
  await page.getByText("Masih ada 1 nota belum terkirim. Sambungkan internet dulu.").waitFor();
  assert.equal(await page.getByRole("button", { name: "Tutup toko" }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: "Serah terima ke kasir berikutnya" }).isDisabled(), true);
  await context.close();
}));

test("nama menu berisi HTML ditampilkan apa adanya", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const nama = "<img src=x onerror=window.__xss=1>";
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await sql.query("update pos_items set name = $1 where name = 'Teh Tarik'", [nama]);
  await page.reload();
  await page.getByRole("button", { name: nama }).waitFor();
  await page.getByRole("button", { name: nama }).click();
  await page.getByRole("dialog").getByRole("button", { name: /14 oz/ }).click();
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "Tunai" }).click();
  await page.getByRole("button", { name: "Uang pas" }).click();
  await ambilFoto(page, foto);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".selesai").waitFor();
  await tab(page, "Nota").click();
  await page.locator(".nota-baris").first().click();
  await page.locator("#app").getByText(nama, { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator("#app img[src='x']").count(), 0);
  await context.close();
}));
