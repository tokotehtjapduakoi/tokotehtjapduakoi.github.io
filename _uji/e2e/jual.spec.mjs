import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import pg from "pg";
import { ambilFoto as ambilFotoUji, bukaHalaman, buatFoto, chromium, isiKeranjang, jalankanServer, rpcSebagai, siapJual, siapkanDb } from "./bantu.mjs";

let db, server, browser, foto, sql;
before(async () => {
  db = await siapkanDb();
  server = await jalankanServer(db.conninfo);
  browser = await chromium.launch();
  sql = new pg.Client({ connectionString: db.conninfo });
  await sql.connect();
  foto = buatFoto();
});
after(async () => {
  await sql?.end();
  await browser?.close();
  await server?.tutup();
  await db?.tutup();
});

const siap = (page, buka) => siapJual(page, buka, server);
const ambilFoto = (page) => ambilFotoUji(page, foto);

test("jual tunai lengkap", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  await isiKeranjang(page, 2);
  await page.getByText("Rp15.000 × 2 = Rp30.000").waitFor();
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "Tunai" }).click();
  await page.getByLabel("Uang diterima").fill("50000");
  await page.getByText("Kembalian Rp20.000").waitFor();
  await ambilFoto(page);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".kembali.besar", { hasText: "Kembalian Rp20.000" }).waitFor();
  assert.match(await page.locator(".selesai .kode").first().innerText(), /^K\d{6}-001$/);
  assert.equal(await page.locator(".qr svg").count(), 1);
  assert.equal(await page.getByRole("link", { name: "Kirim WA" }).count(), 0, "tanpa nomor HP tidak ada tombol WA");
  const n = await sql.query("select count(*)::int as n, sum(total)::int as total from pos_notas");
  assert.deepEqual(n.rows[0], { n: 1, total: 30000 });
  const o = await sql.query("select (metadata->>'size')::int as ukuran, name from storage.objects where bucket_id = 'bukti'");
  assert.equal(o.rowCount, 1);
  assert.ok(o.rows[0].ukuran > 1000 && o.rows[0].ukuran <= 40 * 1024, `ukuran foto ${o.rows[0].ukuran}`);
  assert.match(o.rows[0].name, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/);
  // isi berkas yang disimpan server memang JPEG
  const lihat = await page.evaluate(async (nama) => {
    const t = await (await fetch("/__uji/berkas?path=" + encodeURIComponent("bukti/" + nama))).arrayBuffer();
    return Array.from(new Uint8Array(t).slice(0, 3));
  }, o.rows[0].name);
  assert.deepEqual(lihat, [0xff, 0xd8, 0xff]);
  await context.close();
});

test("lunas nonaktif tanpa foto", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  await isiKeranjang(page);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  assert.equal(await page.getByRole("button", { name: "Lunas" }).isDisabled(), true);
  await ambilFoto(page);
  assert.equal(await page.getByRole("button", { name: "Lunas" }).isDisabled(), false);
  await context.close();
});

test("kirim WA", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  await isiKeranjang(page);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  await page.getByLabel("Nomor HP pelanggan (opsional)").fill("0812-0000-0001");
  await ambilFoto(page);
  await page.getByRole("button", { name: "Lunas" }).click();
  const wa = page.getByRole("link", { name: "Kirim WA" });
  await wa.waitFor();
  const href = await wa.getAttribute("href");
  assert.ok(href.startsWith("https://wa.me/6281200000001?text="), href);
  const teks = decodeURIComponent(href.split("?text=")[1]);
  const kode = (await page.locator("#kode-klaim").innerText()).trim();
  assert.match(kode, /^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
  assert.ok(teks.includes("?kode=" + kode) && teks.includes("Kode: " + kode + " (berlaku 7 hari)"), teks);
  assert.ok(teks.includes("1× Teh Tarik 14 oz  Rp15.000") && teks.includes("Total Rp15.000 (QRIS)"), teks);
  const r = await sql.query("select bound_phone, expires_at - now() > interval '6 days' as tujuh_hari from kk_receipts order by created_at desc limit 1");
  assert.deepEqual(r.rows[0], { bound_phone: "6281200000001", tujuh_hari: true });
  await context.close();
});

test("tidak ada tombol ubah setelah lunas", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  await isiKeranjang(page);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  await ambilFoto(page);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".selesai").waitFor();
  const kontrol = await page.locator("#app").locator("button, a, input, select, textarea").evaluateAll((els) => els.map((e) => (e.textContent || e.id).trim()));
  assert.deepEqual(kontrol.sort(), ["Keluar", "Nota baru"].sort());
  // Nota baru: keranjang bersih, tidak ada sisa nota sebelumnya
  await page.getByRole("button", { name: "Nota baru" }).click();
  await page.getByText("Keranjang kosong").waitFor();
  await context.close();
});

test("harga berubah: menu dimuat ulang, total dihitung ulang", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  await isiKeranjang(page);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  await ambilFoto(page);
  await sql.query("update pos_variants set price = 16000 where name = '14 oz' and item_id = (select id from pos_items where name = 'Teh Tarik')");
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.getByText(/Harga menu berubah/).waitFor();
  // foto sudah terunggah: terkunci supaya percobaan ulang tidak menyimpan foto lain
  const kunci = page.getByRole("button", { name: "Foto terkunci" });
  assert.equal(await kunci.isDisabled(), true);
  await page.getByText(/tidak bisa diganti/).waitFor();
  assert.equal(await page.getByRole("button", { name: "Ganti foto bukti" }).count(), 0);
  await page.locator("#ringkas").getByText("Rp16.000").waitFor();
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".selesai").getByText("Rp16.000").waitFor();
  await context.close();
});

test("kode bentrok diulang otomatis dengan kode baru", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  const kode = [];
  await page.route("**/rest/v1/rpc/pos_checkout", async (route) => {
    kode.push(route.request().postDataJSON().p.code);
    if (kode.length === 1) return route.fulfill({ status: 400, contentType: "application/json",
      body: JSON.stringify({ message: "Kode bentrok, coba lagi" }) });
    return route.continue();
  });
  await isiKeranjang(page);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  await ambilFoto(page);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".qr svg").waitFor();
  assert.equal(kode.length, 2);
  assert.notEqual(kode[0], kode[1]);
  assert.equal((await page.locator("#kode-klaim").innerText()).replace("-", ""), kode[1]);
  await context.close();
});

// Jawaban hilang setelah tersimpan: lihat offline.spec.mjs "kirim ulang tidak dobel" (nota masuk antrean, dikirim ulang).

test("diskon persen yang tidak habis dibagi: total di layar = total server", async () => {
  await sql.query("update pos_variants set price = 17555 where item_id = (select id from pos_items where name = 'Milo Tarik')");
  const d = await rpcSebagai(server, "pemilik@uji.id", "pos_discount_save", { p: { name: "Teman 15", kind: "persen", value: 15 } });
  assert.ok(d);
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  await page.getByRole("button", { name: "Milo Tarik" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /14 oz/ }).click();
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  await page.getByLabel("Diskon (opsional)").selectOption({ label: "Teman 15 (15%)" });
  await page.locator("#ringkas .total").getByText("Rp14.922").waitFor(); // 17555 - floor(2633,25)
  await ambilFoto(page);
  await page.getByRole("button", { name: "Lunas" }).click();
  await page.locator(".selesai .total").getByText("Rp14.922").waitFor();
  const r = await sql.query("select total, discount_amt, server_total, price_mismatch from pos_notas order by received_at desc limit 1");
  assert.deepEqual(r.rows[0], { total: 14922, discount_amt: 2633, server_total: 14922, price_mismatch: false });
  await context.close();
});

test("voucher TK- pada baris qty 2: 1 porsi gratis, teks WA, voucher terpakai", async () => {
  const m = await sql.query(`insert into auth.users(email, raw_user_meta_data) values ('6281200000099@member.tjapduakoi.id', '{"phone":"6281200000099"}') returning id`);
  await sql.query("insert into kk_members(user_id, phone, nickname) values ($1, '6281200000099', 'Uji') on conflict do nothing", [m.rows[0].id]);
  await sql.query("insert into kk_exchanges(member_id, kind, item, points, code) values ($1, 'hadiah', '1 minuman gratis', 30, 'TK-UJI01')", [m.rows[0].id]);
  await sql.query("update pos_variants set price = 16000 where name = '14 oz' and item_id = (select id from pos_items where name = 'Teh Tarik')");
  const { context, page, buka } = await bukaHalaman(browser, server);
  await siap(page, buka);
  await isiKeranjang(page, 2);
  await page.getByRole("button", { name: "Bayar", exact: true }).click();
  await page.getByRole("button", { name: "QRIS" }).click();
  await page.getByLabel("Voucher TK- (opsional)").fill("tk-uji01");
  await page.locator("#ringkas .total").getByText("Rp16.000").waitFor();
  await page.getByLabel("Nomor HP pelanggan (opsional)").fill("081200000003");
  await ambilFoto(page);
  await page.getByRole("button", { name: "Lunas" }).click();
  const wa = page.getByRole("link", { name: "Kirim WA" });
  await wa.waitFor();
  const teks = decodeURIComponent((await wa.getAttribute("href")).split("?text=")[1]);
  assert.ok(teks.includes("1× Teh Tarik 14 oz  Rp16.000\n1× Teh Tarik 14 oz (voucher)  Rp0\nTotal Rp16.000 (QRIS)"), teks);
  const v = await sql.query("select used_at is not null as dipakai from kk_exchanges where code = 'TK-UJI01'");
  assert.equal(v.rows[0].dipakai, true);
  const n = await sql.query("select total, voucher_code from pos_notas order by received_at desc limit 1");
  assert.deepEqual(n.rows[0], { total: 16000, voucher_code: "TK-UJI01" });
  await context.close();
});
