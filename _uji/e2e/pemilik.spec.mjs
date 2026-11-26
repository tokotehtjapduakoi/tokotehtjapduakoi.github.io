import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";
import { ambilFoto, bukaHalaman, buatFoto, chromium, isiKeranjang, jalankanServer, masuk, rpcSebagai, siapJual, siapkanDb } from "./bantu.mjs";

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
async function jualTunai(page, foto, qty = 2) {
  await isiKeranjang(page, qty);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "Tunai" }).click();
  await page.getByRole("button", { name: "Uang pas" }).click();
  await ambilFoto(page, foto);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".selesai .kode", { hasText: /^K\d{6}-\d{3}$/ }).waitFor();
}
async function pemilikMasuk(browser, server, email = "pemilik@uji.id") {
  const h = await bukaHalaman(browser, server);
  await h.buka();
  await masuk(h.page, email);
  await tab(h.page, "Laporan").waitFor();
  return h;
}

test("pemilik menyetujui void", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const k = await bukaHalaman(browser, server);
  await siapJual(k.page, k.buka, server);
  await jualTunai(k.page, foto, 2);
  const no = (await sql.query("select no from pos_notas")).rows[0].no;
  const nota = (await sql.query("select id from pos_notas")).rows[0].id;
  await rpcSebagai(server, "ocha@uji.id", "pos_void_request", { p_nota: nota, p_reason: "pelanggan salah pesan" });
  await k.context.close();

  const { context, page } = await pemilikMasuk(browser, server);
  // badge Setujui = 1 pengajuan batal + 1 HP pemilik sendiri yang belum disetujui (dimuat diam-diam sesudah masuk)
  await page.locator("#tab button", { hasText: "Setujui2" }).waitFor();
  assert.deepEqual(await page.locator("#tab button").allInnerTexts(), ["Jual", "Laporan", "Setujui2", "Atur"]);
  await tab(page, "Laporan").click();
  await page.locator("#lap-omzet", { hasText: "Rp30.000" }).waitFor();
  assert.equal(await page.locator(".peringatan").getByText(/1 pengajuan batal menunggu/).count(), 1);
  await tab(page, "Setujui").click();
  const kartu = page.locator(".kartu-void", { hasText: no });
  await kartu.getByText("pelanggan salah pesan").waitFor();
  await kartu.getByText("Ocha").waitFor();
  await kartu.getByText(/2× Teh Tarik 14 oz/).waitFor();
  await kartu.locator("img.foto-nota").waitFor();
  await page.waitForFunction(() => { const i = document.querySelector(".foto-nota"); return i && i.complete && i.naturalWidth > 0; });
  await kartu.getByRole("button", { name: "Setujui", exact: true }).click();
  assert.equal((await sql.query("select status from pos_notas")).rows[0].status, "lunas", "ketukan pertama belum membatalkan");
  await kartu.getByRole("button", { name: /Yakin setujui/ }).click();
  await page.locator(".hasil", { hasText: `Nota ${no} dibatalkan` }).waitFor();
  assert.equal(await page.locator(".kartu-void").count(), 0);
  assert.equal((await sql.query("select status from pos_notas")).rows[0].status, "batal");
  assert.equal(await page.locator("#kartu-hilang").count(), 0);
  await tab(page, "Laporan").click();
  await page.locator("#lap-omzet", { hasText: "Rp0" }).waitFor();
  await page.locator(".peringatan s.coret", { hasText: no }).waitFor();
  await context.close();
}));

test("void: Tolak butuh dua ketuk dan nota tetap lunas", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const k = await bukaHalaman(browser, server);
  await siapJual(k.page, k.buka, server);
  await jualTunai(k.page, foto, 1);
  const nota = (await sql.query("select id from pos_notas")).rows[0].id;
  await rpcSebagai(server, "ocha@uji.id", "pos_void_request", { p_nota: nota, p_reason: "Salah input" });
  await k.context.close();
  const { context, page } = await pemilikMasuk(browser, server);
  await tab(page, "Setujui").click();
  const tolak = page.getByRole("button", { name: "Tolak", exact: true });
  await tolak.click();
  assert.equal((await sql.query("select decided_at from pos_void_requests")).rows[0].decided_at, null);
  await page.getByRole("button", { name: /Yakin tolak/ }).click();
  await page.locator(".hasil", { hasText: /ditolak/ }).waitFor();
  assert.equal((await sql.query("select status from pos_notas")).rows[0].status, "lunas");
  await context.close();
}));

test("ubah harga tercatat", () => lingkungan(async ({ server, browser, sql }) => {
  const { context, page } = await pemilikMasuk(browser, server);
  await tab(page, "Atur").click();
  await page.getByLabel("Harga Teh Tarik 14 oz", { exact: true }).fill("16.000");
  await page.getByRole("button", { name: "Simpan harga Teh Tarik 14 oz" }).click();
  await page.waitForFunction(() => document.querySelector("#toast").textContent === "Harga tersimpan.");
  const a = await sql.query("select old->>'price' as lama, new->>'price' as baru from pos_audit where tbl = 'pos_variants' and action = 'ubah'");
  assert.deepEqual(a.rows, [{ lama: "15000", baru: "16000" }]);
  assert.equal(await page.getByLabel("Harga Teh Tarik 14 oz", { exact: true }).inputValue(), "16000");
  // nonaktifkan menu: tetap terlihat di Atur sebagai Nonaktif
  await page.locator(".card", { hasText: "Milo Tarik" }).getByRole("button", { name: "Nonaktifkan" }).first().click();
  await page.locator(".card", { hasText: "Milo Tarik" }).locator(".lencana", { hasText: "Nonaktif" }).first().waitFor();
  assert.deepEqual((await sql.query("select active from pos_items where name = 'Milo Tarik'")).rows, [{ active: false }]);
  // menu, metode, diskon baru
  await page.getByLabel("Nama menu").fill("Es Teh");
  await page.getByRole("button", { name: "Tambah menu" }).click();
  await page.locator(".card", { hasText: "Es Teh" }).first().waitFor();
  await page.getByRole("button", { name: "Metode bayar" }).click();
  await page.getByLabel("Nama", { exact: true }).fill("Dana");
  await page.getByLabel("Jenis").selectOption("qris");
  await page.getByRole("button", { name: "Tambah metode" }).click();
  await page.getByText("Dana", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: "Diskon", exact: true }).click();
  await page.getByLabel("Nama", { exact: true }).fill("Teman 10");
  await page.getByLabel("Nilai").fill("10");
  await page.getByRole("button", { name: "Tambah diskon" }).click();
  await page.getByText("Teman 10", { exact: false }).first().waitFor();
  assert.deepEqual((await sql.query("select kind, value from pos_discounts")).rows, [{ kind: "persen", value: 10 }]);
  await page.getByRole("button", { name: "Staf" }).click();
  assert.match(await page.locator("#staf-link").getAttribute("href"), /kolam\/admin\/$/);
  await context.close();
}));

test("perangkat: setujui HP sendiri lalu cabut dengan dua ketuk", () => lingkungan(async ({ server, browser, sql }) => {
  const { context, page } = await pemilikMasuk(browser, server);
  await page.getByRole("heading", { name: "HP ini belum disetujui" }).waitFor();
  assert.equal(await tab(page, "Setujui").getAttribute("aria-current"), null);
  await tab(page, "Setujui").click();
  await page.getByRole("button", { name: /^Setujui perangkat/ }).click();
  await page.getByText("Tidak ada perangkat menunggu.").waitFor();
  await tab(page, "Jual").click();
  await page.getByRole("heading", { name: "Buka toko" }).waitFor();
  await tab(page, "Atur").click();
  await page.getByRole("button", { name: "Perangkat" }).click();
  await page.getByRole("button", { name: /^Cabut perangkat/ }).click();
  assert.equal((await sql.query("select revoked_at from pos_devices")).rows[0].revoked_at, null);
  await page.getByRole("button", { name: /^Cabut perangkat/ }).click();
  await page.getByRole("button", { name: /^Setujui perangkat/ }).waitFor();
  assert.notEqual((await sql.query("select revoked_at from pos_devices")).rows[0].revoked_at, null);
  await context.close();
}));

test("kasir tidak melihat tab pemilik", () => lingkungan(async ({ server, browser }) => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siapJual(page, buka, server);
  assert.deepEqual(await page.locator("#tab button").allInnerTexts(), ["Jual", "Nota", "Kas"]);
  for (const n of ["Laporan", "Atur", "Setujui"]) assert.equal(await page.getByRole("button", { name: n, exact: true }).count(), 0);
  await context.close();
}));

test("pemilik tanpa 2 langkah: layar verifikasi, daftar TOTP, lalu terbuka", () => lingkungan(async ({ server, browser, sql }) => {
  await sql.query("update auth.users set email = 'bos@uji.id' where email = 'pemilik@uji.id'"); // bukan pemilik* = aal1 di server tiruan
  const { context, page, buka } = await bukaHalaman(browser, server);
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
  await buka();
  await masuk(page, "bos@uji.id");
  await tab(page, "Atur").click();
  await page.getByRole("heading", { name: "Verifikasi 2 langkah" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "Atur" }).count(), 0, "Atur tertutup sebelum verifikasi");
  await page.getByRole("button", { name: "Pasang verifikasi 2 langkah" }).click();
  await page.getByAltText("QR verifikasi 2 langkah").waitFor();
  assert.equal(await page.locator("#mfa-rahasia").innerText(), "JBSWY3DPEHPK3PXP");
  const kirim = page.getByRole("button", { name: "Verifikasi", exact: true });
  await page.getByLabel(/Kode 6 angka/).fill("12345");
  assert.equal(await kirim.isDisabled(), true);
  await page.getByLabel(/Kode 6 angka/).fill("000000");
  await kirim.click();
  await page.getByText(/Kode salah/).waitFor();
  await page.getByLabel(/Kode 6 angka/).fill("123456");
  await kirim.click();
  await page.getByRole("heading", { name: "Atur", exact: true }).waitFor();
  await page.getByLabel("Harga Teh Tarik 14 oz", { exact: true }).waitFor();
  await context.close();
}));

test("laporan: peringatan marun, pemilih tanggal", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const k = await bukaHalaman(browser, server);
  await siapJual(k.page, k.buka, server);
  await jualTunai(k.page, foto, 1);
  await k.context.close();
  // nota terkunci oleh pemicu; jalur pembuat database dipakai untuk menyiapkan keadaan uji
  await sql.query("begin; set local session_replication_role = replica; update pos_notas set held = true, price_mismatch = true, offline = true; commit");
  await sql.query("update pos_shifts set closed_at = now(), cash_counted = 90000, handover = false");
  const { context, page } = await pemilikMasuk(browser, server);
  await tab(page, "Laporan").click();
  const w = page.locator(".peringatan");
  await w.getByText(/Selisih kas shift Ocha: −Rp\d/).waitFor();
  await w.getByText(/Nota offline K\d{6}-001 beda harga/).waitFor();
  await w.getByText(/1 nota ditahan/).waitFor();
  assert.equal(await page.locator("#lap-nota").innerText(), "1");
  await page.getByLabel("Tanggal").fill("2020-01-01");
  await page.locator("#lap-omzet", { hasText: "Rp0" }).waitFor();
  assert.equal(await page.locator(".peringatan").count(), 0);
  await context.close();
}));

test("alasan void dan nama perangkat berisi HTML tampil apa adanya", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const xss = "<img src=x onerror=window.__xss=1>";
  const k = await bukaHalaman(browser, server);
  await siapJual(k.page, k.buka, server);
  await jualTunai(k.page, foto, 1);
  const nota = (await sql.query("select id from pos_notas")).rows[0].id;
  await rpcSebagai(server, "ocha@uji.id", "pos_void_request", { p_nota: nota, p_reason: xss });
  await k.context.close();
  await sql.query("insert into pos_devices(id, label) values ('abcd1234abcd1234abcd1234abcd1234', $1)", [xss]);
  const { context, page } = await pemilikMasuk(browser, server);
  await tab(page, "Setujui").click();
  await page.locator(".kartu-void").getByText(xss, { exact: false }).waitFor();
  await page.locator(".baris").getByText(xss, { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.equal(await page.locator("#app img[src='x']").count(), 0);
  await context.close();
}));

test("nota ditahan: tampil di Setujui, lepas tahanan dengan dua ketuk; laporan menandai metode nonaktif", () => lingkungan(async ({ server, browser, sql, foto }) => {
  const k = await bukaHalaman(browser, server);
  await siapJual(k.page, k.buka, server);
  await jualTunai(k.page, foto, 2);
  await k.context.close();
  const no = (await sql.query("select no from pos_notas")).rows[0].no;
  // keadaan seperti nota offline dari HP yang dicabut (nota terkunci pemicu: pakai jalur pembuat database)
  await sql.query("begin; set local session_replication_role = replica; update pos_notas set held = true, offline = true, method_inactive = true; commit");
  await sql.query("update kk_receipts set held = true, expires_at = now() - interval '1 hour'");
  const { context, page } = await pemilikMasuk(browser, server);
  await tab(page, "Laporan").click();
  const w = page.locator(".peringatan");
  await w.getByText(/1 nota ditahan .*tab Setujui/).waitFor();
  await w.getByText(new RegExp(`Nota offline ${no} \\(Rp30\\.000\\) memakai metode bayar "Tunai" yang sudah nonaktif`)).waitFor();
  await tab(page, "Setujui").click();
  await page.getByRole("heading", { name: "Nota ditahan (1)" }).waitFor();
  const kartu = page.locator(".kartu-tahan", { hasText: no });
  await kartu.getByText(/2× Teh Tarik 14 oz/).waitFor();
  await kartu.getByText("Ocha").waitFor();
  await kartu.locator("img.foto-nota").waitFor();
  await kartu.getByRole("button", { name: "Lepas tahanan" }).click();
  assert.equal((await sql.query("select held from pos_notas")).rows[0].held, true, "ketukan pertama belum melepas");
  await kartu.getByRole("button", { name: /Yakin lepas tahanan/ }).click();
  await page.locator(".hasil", { hasText: `Tahanan nota ${no} dilepas` }).waitFor();
  assert.equal(await page.locator(".kartu-tahan").count(), 0);
  const r = (await sql.query("select n.held nh, r.held rh, r.expires_at > now() aktif from pos_notas n join kk_receipts r on r.pos_nota_id = n.id")).rows[0];
  assert.deepEqual(r, { nh: false, rh: false, aktif: true });
  assert.equal((await sql.query("select count(*)::int n from pos_audit where action = 'lepas_tahan'")).rows[0].n, 1);
  await context.close();
}));

// Nota langsung lewat jalur pembuat database (client_at bebas), untuk laporan rentang.
async function notaLangsung(sql, umur, total, kind = "tunai", status = "lunas") {
  const { rows: [s] } = await sql.query(`with k as (select user_id from kk_staff where name = 'Ocha')
    insert into pos_shifts(cashier, device, opened_at, cash_start, closed_at, cash_counted, handover)
    select user_id, 'dev-uji', now() - $1::interval - interval '1 hour', 0, now() - $1::interval + interval '1 hour', 0, false from k
    returning id, cashier`, [umur]);
  await sql.query(`insert into pos_notas(id, no, cashier, device, shift_id, client_at, subtotal, total, server_total, method_id, photo_path, status)
    values (gen_random_uuid(), 'U' || floor(random() * 1e9)::text, $1, 'dev-uji', $2, now() - $3::interval, $4, $4, $4,
            (select id from pos_pay_methods where kind = $5 limit 1), 'f' || random()::text, $6)`, [s.cashier, s.id, umur, total, kind, status]);
}
const hariWita = (geser = 0) => new Date(Date.now() + 8 * 3600e3 + geser * 86400e3).toISOString().slice(0, 10);

test("laporan rentang: saklar Harian | Rentang, tombol cepat, rentang sendiri, diingat", () => lingkungan(async ({ server, browser, sql }) => {
  await notaLangsung(sql, "1 second", 30000);
  await notaLangsung(sql, "1 day", 22000, "qris");
  await notaLangsung(sql, "1 day", 18000, "tunai", "batal");
  await notaLangsung(sql, "10 days", 15000);
  const { context, page } = await pemilikMasuk(browser, server);
  await tab(page, "Laporan").click();
  const mode = (n) => page.getByRole("group", { name: "Jenis laporan" }).getByRole("button", { name: n, exact: true });
  await page.locator("#lap-omzet").waitFor();
  assert.equal(await mode("Harian").getAttribute("aria-pressed"), "true");
  await mode("Rentang").click();
  // bawaan: Bulan ini
  await page.locator("#rg-omzet").waitFor();
  assert.equal(await page.getByLabel("Dari").inputValue(), hariWita().slice(0, 8) + "01");
  assert.equal(await page.getByLabel("Sampai").inputValue(), hariWita());
  await page.getByRole("button", { name: "7 hari" }).click();
  await page.locator("#rg-omzet", { hasText: "Rp52.000" }).waitFor();
  assert.equal(await page.getByLabel("Dari").inputValue(), hariWita(-6));
  assert.equal(await page.locator("#rg-nota").innerText(), "2");
  assert.equal(await page.locator("#rg-avg").innerText(), "Rp26.000");
  assert.equal(await page.locator("#rg-harian").innerText(), "Rp7.429"); // 52.000 / 7 hari
  assert.match(await page.locator("#rg-terbaik").innerText(), /Rp30.000/);
  const svg = page.getByRole("img", { name: /Grafik omzet per hari/ });
  await svg.waitFor();
  assert.equal(await page.locator("#rg-grafik rect").count(), 7);
  assert.equal(await page.locator("#rg-grafik rect.emas").count(), 1, "hari ini = hari terbaik");
  await page.locator("#rg-catatan").getByText("1 nota · Rp18.000").waitFor();
  // rentang sendiri: 10 hari lalu s.d. hari ini
  await page.getByLabel("Dari").fill(hariWita(-10));
  await page.locator("#rg-omzet", { hasText: "Rp67.000" }).waitFor();
  assert.equal(await page.locator("#rg-nota").innerText(), "3");
  // judul rentang bahasa Indonesia + grafik per minggu
  await page.getByLabel("Sampai").fill("2026-06-16");
  await page.getByLabel("Dari").fill("2026-01-13");
  await page.locator("#rg-judul", { hasText: "13 Januari – 16 Juni 2026" }).waitFor();
  await page.getByRole("heading", { name: "Omzet per minggu" }).waitFor();
  await page.getByLabel("Sampai").fill("2027-02-01");
  await page.getByRole("alert").getByText("Rentang paling panjang 366 hari").waitFor();
  await page.getByLabel("Sampai").fill("2026-01-01");
  await page.getByRole("alert").getByText(/Sampai tidak boleh sebelum/).waitFor();
  await page.getByRole("button", { name: "Bulan lalu" }).click();
  const awalIni = new Date(hariWita().slice(0, 8) + "01T00:00:00Z");
  const akhirLalu = new Date(awalIni - 86400e3).toISOString().slice(0, 10);
  await page.locator("#rg-omzet").waitFor();
  assert.equal(await page.getByLabel("Sampai").inputValue(), akhirLalu);
  assert.equal(await page.getByLabel("Dari").inputValue(), akhirLalu.slice(0, 8) + "01");
  // diingat setelah halaman dibuka ulang
  await page.reload();
  await tab(page, "Laporan").click();
  await page.locator("#rg-omzet").waitFor();
  assert.equal(await mode("Rentang").getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByLabel("Sampai").inputValue(), akhirLalu);
  await mode("Harian").click();
  await page.locator("#lap-omzet", { hasText: "Rp30.000" }).waitFor();
  assert.equal(await page.locator("#rg-omzet").count(), 0);
  await context.close();
}));
