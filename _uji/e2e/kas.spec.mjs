import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { ambilFoto, bukaHalaman, buatFoto, chromium, isiKeranjang, jalankanServer, masuk, siapJual, siapkanDb } from "./bantu.mjs";

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
const tab = (page, nama) => page.locator("#tab").getByRole("button", { name: nama, exact: true });
async function fotoKas(page, foto) {
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.getByRole("button", { name: /foto bukti kas/ }).click()]);
  await fc.setFiles(foto);
  await page.getByAltText("Pratinjau foto kas").waitFor();
}

test("pemilik ambil kas dengan foto: laci seharusnya turun, kasir tidak melihat jumlah, laporan mencatat", () => lingkungan(async ({ server, browser, sql, foto }) => {
  // Ocha jualan tunai Rp15.000 di shift bermodal Rp100.000
  const k = await bukaHalaman(browser, server);
  await siapJual(k.page, k.buka, server);
  await isiKeranjang(k.page, 1);
  await k.page.getByRole("button", { name: "Bayar", exact: true }).click();
  await k.page.getByRole("button", { name: "Tunai" }).click();
  await k.page.getByRole("button", { name: "Uang pas" }).click();
  await ambilFoto(k.page, foto);
  await k.page.getByRole("button", { name: "Lunas" }).click();
  await k.page.locator(".selesai .kode").first().waitFor();
  await tab(k.page, "Kas").click();
  await k.page.getByRole("heading", { name: "Kas" }).waitFor();
  assert.equal(await k.page.locator("#kas-pemilik").count(), 0);

  const { context, page, buka } = await bukaHalaman(browser, server);
  await buka();
  await masuk(page, "pemilik@uji.id");
  await tab(page, "Atur").click();
  await page.getByRole("button", { name: "Laci kas", exact: true }).click();
  await page.locator("#kas-seharusnya", { hasText: "Rp115.000" }).waitFor();
  await page.locator("#kas-keadaan", { hasText: "Shift Ocha sedang berjalan" }).waitFor();
  await page.getByRole("button", { name: "Ambil kas", exact: true }).click();
  await page.getByLabel("Jumlah (Rp)").pressSequentially("50000");
  assert.equal(await page.getByLabel("Jumlah (Rp)").inputValue(), "50.000");
  await page.getByRole("button", { name: "Setor ke bank" }).click();
  assert.equal(await page.getByLabel(/Tulis alasan/).inputValue(), "Setor ke bank");
  const kirim = page.locator("#kas-kirim");
  assert.equal(await kirim.isDisabled(), true, "foto wajib untuk ambil kas");
  await fotoKas(page, foto);
  // lebar HP: tidak ada geser ke samping
  await page.setViewportSize({ width: 360, height: 780 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: process.env.KAS_SHOT || "/dev/null", fullPage: true }).catch(() => {});
  await page.setViewportSize({ width: 1280, height: 720 });
  await kirim.click();
  await page.locator("#kas-kirim", { hasText: "Yakin ambil Rp50.000? Ketuk lagi" }).waitFor();
  assert.equal((await sql.query("select count(*)::int n from pos_cash_moves")).rows[0].n, 0, "ketukan pertama belum mencatat");
  await page.locator("#kas-kirim").click();
  await page.locator("#kas-hasil", { hasText: "Sekarang seharusnya di laci: Rp65.000" }).waitFor();
  await page.locator("#kas-seharusnya", { hasText: "Rp65.000" }).waitFor();
  await page.locator("#kas-hari-ini", { hasText: "Setor ke bank" }).getByText("−Rp50.000").waitFor();
  const { rows: [m] } = await sql.query("select kind, amount, reason, photo_path, after_close from pos_cash_moves");
  assert.deepEqual({ ...m, photo_path: undefined }, { kind: "ambil", amount: 50000, reason: "Setor ke bank", photo_path: undefined, after_close: false });
  assert.match(m.photo_path, /^[0-9a-f-]{36}\/kas-[0-9a-f]{16}\.jpg$/);
  assert.equal((await sql.query("select count(*)::int n from storage.objects where name = $1", [m.photo_path])).rows[0].n, 1);
  assert.equal((await sql.query("select count(*)::int n from pos_audit where tbl = 'pos_cash_moves'")).rows[0].n, 1);

  // ambil melebihi laci ditolak dengan jumlah seharusnya
  await page.getByRole("button", { name: "Ambil kas", exact: true }).click();
  await page.getByLabel("Jumlah (Rp)").fill("70000");
  await page.getByLabel(/Tulis alasan/).fill("Ambil pribadi");
  await fotoKas(page, foto);
  await page.locator("#kas-kirim").click();
  await page.locator("#kas-kirim").click();
  await page.locator("#kas-pesan", { hasText: "seharusnya 65.000" }).waitFor();
  assert.equal((await sql.query("select count(*)::int n from pos_cash_moves")).rows[0].n, 1);
  await page.getByRole("button", { name: "Tidak jadi" }).click();

  // kasir: hanya tanda netral, tanpa jumlah (hitungan tetap buta)
  await tab(k.page, "Jual").click();
  await tab(k.page, "Kas").click();
  await k.page.locator("#kas-pemilik", { hasText: "Pemilik mencatat ambil/tambah kas hari ini" }).waitFor();
  assert.doesNotMatch(await k.page.locator("#app").innerText(), /50\.000|65\.000|115\.000/);

  // laporan harian + rentang
  await tab(page, "Laporan").click();
  await page.locator("#lap-kas", { hasText: "Setor ke bank" }).waitFor();
  assert.match(await page.locator("#lap-kas").innerText(), /Ambil kas\s+−Rp50\.000/);
  await page.locator("#lap-shift", { hasText: "ambil kas Rp50.000" }).waitFor();
  await page.getByRole("group", { name: "Jenis laporan" }).getByRole("button", { name: "Rentang" }).click();
  await page.locator("#rg-catatan", { hasText: "Ambil kas" }).waitFor();
  assert.match(await page.locator("#rg-catatan").innerText(), /Ambil kas\s+−Rp50\.000/);
  await context.close();
  await k.context.close();
}));
