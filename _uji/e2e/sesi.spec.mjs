import assert from "node:assert/strict";
import pg from "pg";
import { after, before, test } from "node:test";
import { bukaHalaman, chromium, jalankanServer, SANDI, siapJual, siapkanDb } from "./bantu.mjs";

let db, server, browser;
before(async () => {
  db = await siapkanDb();
  server = await jalankanServer(db.conninfo);
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await server?.tutup();
  await db?.tutup();
});

const RAW = /Auth session missing|invalid JWT|JWT expired|Refresh Token/i;
const json = (r, status, o) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) });
async function masukAdmin(page, email) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(SANDI);
  await page.locator("#ab").click();
}
const tunggu = async (page, teks) => page.locator("#toast").getByText(teks).waitFor();

test("admin: sesi hilang dari penyimpanan lalu halaman dibuka lagi -> layar masuk + toast ramah", async () => {
  const { context, page } = await bukaHalaman(browser, server);
  await page.goto(server.url + "/kolam/admin/");
  await masukAdmin(page, "ocha@uji.id");
  await page.locator("#tabs").waitFor();
  await page.evaluate(() => localStorage.removeItem("kolamkoi-admin-auth"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await tunggu(page, "Sesi habis, silakan masuk lagi.");
  await page.locator("#af").waitFor();
  assert.equal(await page.locator("#tabs").isHidden(), true);
  assert.doesNotMatch(await page.locator("body").innerText(), RAW);
  await context.close();
});

test("kasir: sesi hilang dari penyimpanan lalu fokus kembali -> layar masuk + toast ramah", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await page.evaluate(() => localStorage.removeItem("kasir-auth"));
  await page.evaluate(() => dispatchEvent(new Event("focus")));
  await tunggu(page, "Sesi habis, silakan masuk lagi.");
  await page.getByRole("button", { name: "Masuk" }).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), RAW);
  await context.close();
});

test("kasir: server menjawab JWT expired saat membuka tab Nota -> layar masuk, bukan galat Inggris", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  await context.route("**/rest/v1/rpc/pos_my_notas", (r) => json(r, 401, { code: "PGRST301", message: "JWT expired" }));
  await page.getByRole("button", { name: "Nota", exact: true }).click();
  await tunggu(page, "Sesi habis, silakan masuk lagi.");
  await page.getByRole("button", { name: "Masuk" }).waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), RAW);
  await context.close();
});

// Terakhir: mengganti email pemilik di database bersama.
test("admin: kartu verifikasi 2 langkah, Auth menolak sesi (401) -> tidak ada galat mentah, layar masuk", async () => {
  const sql = new pg.Client({ connectionString: db.conninfo });
  await sql.connect();
  await sql.query("update auth.users set email = 'bos@uji.id' where email = 'pemilik@uji.id'"); // bukan pemilik* = aal1: kartu MFA tampil
  await sql.query("update kk_settings set kasir_nota_manual = false");
  await sql.end();
  const { context, page } = await bukaHalaman(browser, server);
  await page.goto(server.url + "/kolam/admin/");
  await masukAdmin(page, "bos@uji.id");
  await page.getByRole("heading", { name: "Verifikasi 2 langkah" }).waitFor();
  await context.route("**/auth/v1/factors", (r) => json(r, 401, { code: 401, msg: "invalid JWT: token is expired" }));
  await page.getByRole("button", { name: "Pasang verifikasi 2 langkah" }).click();
  await tunggu(page, "Sesi habis, silakan masuk lagi.");
  await page.locator("#af").waitFor();
  assert.doesNotMatch(await page.locator("body").innerText(), RAW);
  await context.close();
});
