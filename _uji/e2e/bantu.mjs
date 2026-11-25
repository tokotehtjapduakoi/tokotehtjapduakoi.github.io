// Alat bantu uji e2e: database contoh, server tiruan, browser, login.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

// Playwright sudah terpasang global di /opt/node-tools (jangan npm install browser).
const require = createRequire("/opt/node-tools/node_modules/");
export const { chromium } = require("playwright");

const UJI = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const AKAR = path.dirname(UJI);
export const SANDI = "rahasia1";

// Tunggu baris stdout pertama yang cocok; gagal bila proses keluar duluan.
function tungguBaris(proc, pola) {
  return new Promise((ok, gagal) => {
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on("line", (b) => { if (pola.test(b)) { rl.close(); ok(b); } });
    proc.once("exit", (kode) => gagal(new Error(`proses keluar (${kode}) sebelum siap`)));
  });
}

function berhenti(proc) {
  return new Promise((ok) => { if (proc.exitCode !== null) return ok(); proc.once("exit", () => ok()); });
}

/** Cluster + database berisi data contoh (python3 _uji/db.py --buat). tutup() menutup stdin → cluster dihapus. */
export async function siapkanDb() {
  const p = spawn("python3", [path.join(UJI, "db.py"), "--buat"], { stdio: ["pipe", "pipe", "inherit"] });
  const { conninfo } = JSON.parse(await tungguBaris(p, /^\{/));
  return { conninfo, tutup: () => { p.stdin.end(); return berhenti(p); } };
}

/** Server tiruan di port acak; menyajikan repo sebagai web statis. */
export async function jalankanServer(conninfo) {
  const p = spawn("node", [path.join(UJI, "server_tiruan.mjs"), "--db", conninfo, "--port", "0", "--web", AKAR],
    { stdio: ["ignore", "pipe", "inherit"] });
  const url = (await tungguBaris(p, /^siap /)).slice(5).trim();
  return { url, tutup: () => { p.kill(); return berhenti(p); } };
}

/** Konteks + halaman baru (localStorage kosong = HP baru) dengan config.js diarahkan ke server tiruan. */
export async function bukaHalaman(browser, server) {
  const context = await browser.newContext();
  await context.route(/^https:\/\/fonts\./, (r) => r.abort()); // uji tidak butuh font dari internet
  const page = await context.newPage();
  await page.route("**/kasir/config.js", (r) => r.fulfill({
    contentType: "application/javascript",
    body: `window.KASIR_CONFIG=${JSON.stringify({ supabaseUrl: server.url, supabaseKey: "uji-anon",
      kolamUrl: "https://tokotehtjapduakoi.github.io/kolam/" })};`,
  }));
  return { context, page, buka: () => page.goto(server.url + "/kasir/") };
}

export async function masuk(page, email, sandi = SANDI) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Kata sandi").fill(sandi);
  await page.getByRole("button", { name: "Masuk" }).click();
}

/** Panggil RPC lewat server tiruan sebagai user tertentu (email diawali "pemilik" → aal2). */
export async function rpcSebagai(server, email, fn, args = {}) {
  const t = await fetch(`${server.url}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: SANDI }),
  });
  const { access_token } = await t.json();
  const r = await fetch(`${server.url}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${access_token}` },
    body: JSON.stringify(args),
  });
  const isi = await r.json();
  if (!r.ok) throw new Error(isi.message);
  return isi;
}
