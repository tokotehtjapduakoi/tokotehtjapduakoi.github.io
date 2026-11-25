import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { bukaHalaman, chromium, jalankanServer, masuk, rpcSebagai, siapkanDb } from "./bantu.mjs";

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

const formLogin = (page) => page.getByRole("button", { name: "Masuk" });

test("kasir baru menunggu persetujuan", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await buka();
  await masuk(page, "ocha@uji.id");
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  await context.close();
});

test("setelah disetujui masuk layar jual", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await buka();
  await page.getByLabel("Nama HP ini (opsional)").fill("HP kasir depan");
  await masuk(page, "budi@uji.id");
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  const device = await page.evaluate(() => localStorage.getItem("kasir.device"));
  assert.match(device, /^[0-9a-f]{32}$/);
  const daftar = await rpcSebagai(server, "pemilik@uji.id", "pos_devices_list");
  assert.match(daftar.find((d) => d.id === device).label, /^HP kasir depan · /);
  await rpcSebagai(server, "pemilik@uji.id", "pos_device_decide", { p_device: device, p_approve: true });
  await page.getByRole("button", { name: "Cek lagi" }).click();
  await page.getByText("Buka shift dulu").waitFor(); // disetujui, tapi shift belum dibuka (UI shift: Task 11)
  await rpcSebagai(server, "budi@uji.id", "pos_shift_open", { p_device: device, p_cash_start: 0 });
  await page.getByRole("button", { name: "Cek lagi" }).click();
  await page.getByRole("button", { name: "Teh Tarik" }).waitFor();
  await context.close();
});

test("logout otomatis setelah diam 30 menit", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await page.clock.install();
  await buka();
  await masuk(page, "ocha@uji.id");
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  await page.clock.fastForward("29:00");
  await page.clock.fastForward("00:30");
  await page.waitForTimeout(300); // beri waktu bila logout (async) keliru terpicu
  assert.equal(await formLogin(page).count(), 0, "belum 30 menit: masih masuk");
  await page.clock.fastForward("01:30");
  await formLogin(page).waitFor();
  await context.close();
});

test("tidak logout otomatis selama antrean belum kosong", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await page.addInitScript(() => { window.Antrean = { jumlah: () => 1 }; });
  await page.clock.install();
  await buka();
  await masuk(page, "ocha@uji.id");
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  await page.clock.fastForward("31:00");
  await page.clock.fastForward("00:30");
  await page.waitForTimeout(300);
  assert.equal(await formLogin(page).count(), 0);
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  await context.close();
});

test("sentuhan layar mengulang hitungan diam", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await page.clock.install();
  await buka();
  await masuk(page, "ocha@uji.id");
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  await page.clock.fastForward("20:00");
  await page.mouse.click(10, 10); // pointerdown
  await page.clock.fastForward("20:00");
  await page.clock.fastForward("00:30");
  await page.waitForTimeout(300);
  assert.equal(await formLogin(page).count(), 0, "40 menit sejak masuk tetapi 20 menit sejak sentuhan: masih masuk");
  await page.getByText("Menunggu persetujuan pemilik").waitFor();
  await page.clock.fastForward("11:00");
  await formLogin(page).waitFor();
  await context.close();
});

test("bukan staf ditolak", async () => {
  const { context, page, buka } = await bukaHalaman(browser, server);
  await buka();
  await masuk(page, "tamu@uji.id");
  await page.getByText("Akun ini bukan staf toko").waitFor();
  await formLogin(page).waitFor();
  await context.close();
});
