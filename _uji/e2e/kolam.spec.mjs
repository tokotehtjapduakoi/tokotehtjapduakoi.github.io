import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { bukaHalaman, chromium, jalankanServer, SANDI, siapkanDb } from "./bantu.mjs";

async function lingkungan(isi) {
  const db = await siapkanDb();
  const server = await jalankanServer(db.conninfo);
  const browser = await chromium.launch();
  const sql = new pg.Client({ connectionString: db.conninfo });
  await sql.connect();
  try { await isi({ db, server, browser, sql }); }
  finally { await sql.end(); await browser.close(); await server.tutup(); await db.tutup(); }
}
const KODE = "ABCDE-23456";

/** Nota berkode seperti yang dibuat kasir (hanya hash kode yang tersimpan). */
async function buatNota(sql, { kode = KODE, total = 45000, terikat = null, nota = "POS-UJI-1", kasir = "ocha@uji.id" } = {}) {
  const k = kode.replace(/-/g, "");
  await sql.query(
    `insert into kk_receipts(nota, total, created_by, code_hash, bound_phone, expires_at)
     values ($1, $2, (select id from auth.users where email = $3), encode(extensions.digest($4, 'sha256'), 'hex'), $5, now() + interval '2 hours')`,
    [nota, total, kasir, k, terikat]);
}
async function daftarMember(page, hp, nama = "Rina") {
  await page.getByRole("button", { name: "Daftar baru" }).click();
  await page.getByLabel("Nomor HP").fill(hp);
  await page.getByLabel("Nama panggilan").fill(nama);
  await page.getByLabel("PIN 6 angka", { exact: true }).fill("493817");
  await page.getByLabel("Ulangi PIN").fill("493817");
  await page.getByRole("button", { name: "Daftar & mulai" }).click();
}
async function masuk(page, email) { // admin punya dua tombol "Masuk" (pilihan + kirim)
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(SANDI);
  await page.locator("#ab").click();
}
const buka = (h, server, jalur) => h.page.goto(server.url + jalur);

test("klaim dari link WA", () => lingkungan(async ({ server, browser, sql }) => {
  await buatNota(sql);
  const h = await bukaHalaman(browser, server);
  await buka(h, server, `/kolam/?kode=${KODE}`);
  await h.page.getByText("Kodemu sudah tersimpan").waitFor();
  // kode langsung dibuang dari URL, tetapi tidak hilang
  assert.doesNotMatch(h.page.url(), /kode/);
  await daftarMember(h.page, "081234567890");
  await h.page.getByRole("dialog", { name: "Hasil tarikan" }).waitFor(); // animasi tarikan
  const r = (await sql.query("select claimed_by, claimed_at from kk_receipts where nota = 'POS-UJI-1'")).rows[0];
  assert.ok(r.claimed_by && r.claimed_at, "nota terklaim");
  assert.equal((await sql.query("select count(*)::int n from kk_pulls")).rows[0].n, 2);
  assert.doesNotMatch(h.page.url(), /kode/);
  assert.equal(await h.page.evaluate(() => sessionStorage.getItem("kolamkoi-kode")), null);
  await h.context.close();
}));

test("klaim lewat isian kode + kode salah masuk daftar tunggu", () => lingkungan(async ({ server, browser, sql }) => {
  await buatNota(sql);
  const h = await bukaHalaman(browser, server);
  await buka(h, server, "/kolam/");
  await daftarMember(h.page, "081234567890");
  await h.page.getByRole("heading", { name: "Masukkan kode" }).waitFor();
  assert.equal(await h.page.getByLabel("Kode").getAttribute("autocapitalize"), "characters");
  await h.page.getByLabel("Kode").fill("zzzzz22222");
  assert.equal(await h.page.getByLabel("Kode").inputValue(), "ZZZZZ-22222");
  await h.page.getByRole("button", { name: "Cek kode & tarik" }).click();
  await h.page.getByText(/Kode belum dikenali/).waitFor();
  await h.page.getByRole("heading", { name: "Belum bisa dipakai" }).waitFor();
  await h.page.getByLabel("Kode").fill(KODE.toLowerCase());
  await h.page.getByRole("button", { name: "Cek kode & tarik" }).click();
  await h.page.getByRole("dialog", { name: "Hasil tarikan" }).waitFor();
  await h.context.close();
}));

test("kode nomor lain: wrong_phone", () => lingkungan(async ({ server, browser, sql }) => {
  await buatNota(sql, { terikat: "6281999999999" });
  const h = await bukaHalaman(browser, server);
  await buka(h, server, `/kolam/?kode=${KODE}`);
  await daftarMember(h.page, "081234567890");
  await h.page.getByText("Kode ini untuk nomor HP lain. Masuk dengan nomor yang dipakai saat belanja").waitFor();
  assert.equal(await h.page.getByRole("dialog").count(), 0);
  assert.equal((await sql.query("select claimed_by from kk_receipts")).rows[0].claimed_by, null);
  await h.context.close();
}));

test("pesan status lain: kedaluwarsa, dibatalkan, diperiksa toko", () => lingkungan(async ({ server, browser, sql }) => {
  const h = await bukaHalaman(browser, server);
  await buka(h, server, "/kolam/");
  await daftarMember(h.page, "081234567890");
  const coba = async (kode, teks) => {
    await h.page.getByLabel("Kode").fill(kode);
    await h.page.getByRole("button", { name: "Cek kode & tarik" }).click();
    await h.page.getByText(teks).waitFor();
  };
  await buatNota(sql, { kode: "KKKKK-22222", nota: "P-EXP" });
  await sql.query("update kk_receipts set expires_at = now() - interval '1 minute' where nota = 'P-EXP'");
  await coba("KKKKK-22222", "Kode sudah kedaluwarsa");
  await buatNota(sql, { kode: "MMMMM-22222", nota: "P-VOID" });
  await sql.query("update kk_receipts set voided_at = now() where nota = 'P-VOID'");
  await coba("MMMMM-22222", "Nota ini dibatalkan");
  await buatNota(sql, { kode: "NNNNN-22222", nota: "P-HELD" });
  await sql.query("update kk_receipts set held = true where nota = 'P-HELD'");
  await coba("NNNNN-22222", "Nota sedang diperiksa toko. Coba lagi nanti");
  await h.page.getByRole("heading", { name: "Belum bisa dipakai" }).waitFor();
  await h.context.close();
}));

test("klaim lama: tautan kecil hanya bila sakelar menyala", () => lingkungan(async ({ server, browser, sql }) => {
  const h = await bukaHalaman(browser, server);
  await buka(h, server, "/kolam/");
  await daftarMember(h.page, "081234567890");
  const tautan = h.page.getByRole("link", { name: /Punya nota lama/ });
  await tautan.waitFor();
  assert.equal(await h.page.getByLabel("Nomor nota").isVisible(), false);
  await tautan.click();
  await h.page.getByLabel("Nomor nota").waitFor();
  await h.page.getByLabel(/Total belanja/).waitFor();
  await sql.query("update kk_settings set legacy_nota_claim = false");
  await h.page.reload();
  await h.page.getByRole("heading", { name: "Masukkan kode" }).waitFor();
  assert.equal(await h.page.getByRole("link", { name: /Punya nota lama/ }).count(), 0);
  await h.context.close();
}));

test("kasir tidak melihat tab Nota admin", () => lingkungan(async ({ server, browser }) => {
  const h = await bukaHalaman(browser, server);
  await buka(h, server, "/kolam/admin/");
  await masuk(h.page, "ocha@uji.id");
  await h.page.locator("#tabs").getByRole("button", { name: "Voucher" }).waitFor();
  assert.deepEqual(await h.page.locator("#tabs button").allInnerTexts(), ["Voucher", "Member"]);
  assert.equal(await h.page.getByRole("heading", { name: "Verifikasi 2 langkah" }).count(), 0);
  await h.context.close();
}));

test("pemilik (aal2): tab Nota, sakelar klaim lama, staf dengan nomor HP", () => lingkungan(async ({ server, browser, sql }) => {
  const h = await bukaHalaman(browser, server);
  await buka(h, server, "/kolam/admin/");
  await masuk(h.page, "pemilik@uji.id");
  await h.page.locator("#tabs").getByRole("button", { name: "Nota" }).waitFor();
  assert.deepEqual(await h.page.locator("#tabs button").allInnerTexts(), ["Nota", "Voucher", "Member", "Staf"]);
  const lg = h.page.getByLabel("Klaim nomor nota lama (ESB)");
  await lg.waitFor();
  assert.equal(await lg.isChecked(), true);
  await lg.uncheck();
  await h.page.getByText("Klaim nomor nota lama dimatikan").waitFor();
  assert.equal((await sql.query("select legacy_nota_claim from kk_settings")).rows[0].legacy_nota_claim, false);
  await h.page.locator("#tabs").getByRole("button", { name: "Staf" }).click();
  await h.page.getByLabel("Email kasir").fill("budi@uji.id");
  await h.page.getByLabel("Nama", { exact: true }).fill("Budi");
  await h.page.getByLabel(/Nomor HP/).fill("0812 5550 1234");
  await h.page.getByRole("button", { name: "Simpan", exact: true }).click();
  await h.page.getByText("Staf disimpan.").waitFor();
  assert.equal((await sql.query("select phone from kk_staff where name = 'Budi'")).rows[0].phone, "6281255501234");
  await h.context.close();
}));

test("pemilik tanpa 2 langkah di admin: daftar TOTP lewat KoiMfa, lalu tab Nota terbuka", () => lingkungan(async ({ server, browser, sql }) => {
  await sql.query("update auth.users set email = 'bos@uji.id' where email = 'pemilik@uji.id'"); // bukan pemilik* = aal1 di server tiruan
  const h = await bukaHalaman(browser, server);
  const { context, page } = h;
  let terverifikasi = false;
  const json = (r, o) => r.fulfill({ contentType: "application/json", body: JSON.stringify(o) });
  await context.route("**/auth/v1/factors", (r) => json(r, { id: "f1", type: "totp", friendly_name: "x",
    totp: { qr_code: "data:image/svg+xml;utf-8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>", secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/x" } }));
  await context.route("**/auth/v1/factors/f1/challenge", (r) => json(r, { id: "c1", type: "totp", expires_at: Math.floor(Date.now() / 1000) + 300 }));
  await context.route("**/auth/v1/factors/f1/verify", async (r) => {
    const kode = JSON.parse(r.request().postData()).code;
    if (kode !== "123456") return r.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ code: 422, error_code: "mfa_verification_failed", msg: "Invalid TOTP code entered" }) });
    terverifikasi = true;
    const t = await fetch(`${server.url}/auth/v1/token?grant_type=password`, { method: "POST",
      headers: { "content-type": "application/json", "x-uji-aal2": "1" }, body: JSON.stringify({ email: "bos@uji.id", password: "rahasia1" }) });
    json(r, await t.json());
  });
  await context.route("**/auth/v1/token?grant_type=refresh_token", (r) =>
    r.continue({ headers: { ...r.request().headers(), ...(terverifikasi ? { "x-uji-aal2": "1" } : {}) } }));
  await buka(h, server, "/kolam/admin/");
  await masuk(page, "bos@uji.id");
  await page.getByRole("heading", { name: "Verifikasi 2 langkah" }).waitFor();
  assert.deepEqual(await page.locator("#tabs button").allInnerTexts(), ["Voucher", "Member", "Staf"]);
  await page.getByRole("button", { name: "Pasang verifikasi 2 langkah" }).click();
  await page.getByAltText("QR verifikasi 2 langkah").waitFor();
  assert.equal(await page.locator("#mfa-rahasia").innerText(), "JBSWY3DPEHPK3PXP");
  await page.getByLabel(/Kode 6 angka/).fill("000000");
  await page.getByRole("button", { name: "Verifikasi", exact: true }).click();
  await page.getByText(/Kode salah/).waitFor();
  await page.getByLabel(/Kode 6 angka/).fill("123456");
  await page.getByRole("button", { name: "Verifikasi", exact: true }).click();
  await page.locator("#tabs").getByRole("button", { name: "Nota" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Verifikasi 2 langkah" }).count(), 0);
  await context.close();
}));

test("pemilik tanpa 2 langkah: gagal memeriksa faktor tidak mengulang terus, Coba lagi jalan", () => lingkungan(async ({ server, browser, sql }) => {
  await sql.query("update auth.users set email = 'bos@uji.id' where email = 'pemilik@uji.id'");
  const h = await bukaHalaman(browser, server);
  const { context, page } = h;
  let gagal = 0, panggilan = 0, aktif = false;
  await context.route("**/auth/v1/user", (r) => {
    if (!aktif) return r.continue();
    panggilan++;
    if (gagal < 1) { gagal++; return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "galat uji" }) }); }
    return r.continue();
  });
  await buka(h, server, "/kolam/admin/");
  aktif = true;
  await masuk(page, "bos@uji.id");
  const ulang = page.getByRole("button", { name: "Coba lagi" });
  await ulang.waitFor();
  await page.waitForTimeout(1500);
  assert.equal(panggilan, 1, "tidak mengulang sendiri");
  await ulang.click();
  await page.getByRole("button", { name: "Pasang verifikasi 2 langkah" }).waitFor();
  assert.equal(panggilan, 2);
  await context.close();
}));

test("kode dari link: jaringan putus -> daftar tunggu -> Cek lagi berhasil, dan tidak diklaim dua kali", () => lingkungan(async ({ server, browser, sql }) => {
  await buatNota(sql);
  const h = await bukaHalaman(browser, server);
  let putus = true;
  await h.context.route("**/rest/v1/rpc/kk_claim_code", (r) => { if (putus) { putus = false; return r.abort(); } return r.continue(); });
  await buka(h, server, `/kolam/?kode=${KODE}`);
  await daftarMember(h.page, "081234567890");
  await h.page.getByRole("heading", { name: "Belum bisa dipakai" }).waitFor();
  await h.page.getByText(KODE).waitFor();
  assert.equal((await sql.query("select count(*)::int n from kk_pulls")).rows[0].n, 0);
  await h.page.getByRole("button", { name: "Cek lagi" }).click();
  await h.page.getByRole("dialog", { name: "Hasil tarikan" }).waitFor();
  const n = (await sql.query("select count(*)::int n from kk_pulls")).rows[0].n;
  assert.equal(n, 2);
  await h.page.reload();
  await h.page.getByRole("heading", { name: "Masukkan kode" }).waitFor();
  await h.page.waitForTimeout(1000);
  assert.equal((await sql.query("select count(*)::int n from kk_pulls")).rows[0].n, n, "tidak diklaim ulang");
  assert.equal(await h.page.getByRole("dialog").count(), 0);
  await h.context.close();
}));

test("klaim lama mati: tidak ada tautan dan baris tunggu bergaya nota disembunyikan", () => lingkungan(async ({ server, browser, sql }) => {
  await sql.query("update kk_settings set legacy_nota_claim = false");
  const h = await bukaHalaman(browser, server);
  await buka(h, server, "/kolam/");
  await daftarMember(h.page, "081234567890");
  await h.page.getByRole("heading", { name: "Masukkan kode" }).waitFor();
  await h.page.evaluate(() => localStorage.setItem("kolamkoi-v1-6281234567890", JSON.stringify({ wait: [{ nota: "NOTA-LAMA", total: 30000 }] })));
  await h.page.reload();
  await h.page.getByRole("heading", { name: "Masukkan kode" }).waitFor();
  assert.equal(await h.page.getByRole("link", { name: /Punya nota lama/ }).count(), 0);
  assert.equal(await h.page.getByLabel("Nomor nota").count(), 0);
  assert.equal(await h.page.getByText("NOTA-LAMA").count(), 0);
  await h.context.close();
}));

test("admin: baris kk_settings tidak ada = sakelar klaim lama mati", () => lingkungan(async ({ server, browser, sql }) => {
  await sql.query("delete from kk_settings");
  const h = await bukaHalaman(browser, server);
  await buka(h, server, "/kolam/admin/");
  await masuk(h.page, "pemilik@uji.id");
  const lg = h.page.getByLabel("Klaim nomor nota lama (ESB)");
  await lg.waitFor();
  assert.equal(await lg.isChecked(), false);
  await h.context.close();
}));
