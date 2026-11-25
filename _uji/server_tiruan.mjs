// Server tiruan Supabase untuk uji e2e (auth, rpc, storage) + web statis repo.
// node server_tiruan.mjs --db <conninfo> --port 8787 --web <akar repo>
// Hak akses meniru harness pytest: tiap permintaan jalan sebagai role anon/authenticated
// dengan request.jwt.claims, jadi RLS dan grant berlaku sama.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { parseArgs } from "node:util";
import pg from "pg";

const { values: opsi } = parseArgs({ options: { db: { type: "string" }, port: { type: "string", default: "8787" },
  web: { type: "string", default: "." } } });
const WEB = path.resolve(opsi.web);
const RAHASIA = "uji";
const pool = new pg.Pool({ connectionString: opsi.db, max: 4 });

// ---------- JWT HS256 ----------
const b64 = (s) => Buffer.from(s).toString("base64url");
const tandaTangan = (data) => crypto.createHmac("sha256", RAHASIA).update(data).digest("base64url");
function jwt(klaim) {
  const kepala = b64(JSON.stringify({ alg: "HS256", typ: "JWT" })) + "." + b64(JSON.stringify(klaim));
  return kepala + "." + tandaTangan(kepala);
}
function bacaJwt(token) {
  const [h, p, t] = String(token || "").split(".");
  if (!t || tandaTangan(h + "." + p) !== t) return null;
  const klaim = JSON.parse(Buffer.from(p, "base64url").toString());
  return klaim.exp && klaim.exp * 1000 < Date.now() ? null : klaim;
}
const klaimDari = (req) => bacaJwt((req.headers.authorization || "").replace(/^Bearer /i, "")) || { role: "anon" };

// ---------- Bantuan HTTP ----------
function kirim(res, status, isi, tipe = "application/json") {
  const body = isi === undefined ? "" : Buffer.isBuffer(isi) ? isi : JSON.stringify(isi);
  res.writeHead(status, { "content-type": tipe, "access-control-allow-origin": "*" });
  res.end(body);
}
function bacaBody(req) {
  return new Promise((ok, gagal) => {
    const bagian = [];
    req.on("data", (b) => bagian.push(b));
    req.on("end", () => ok(Buffer.concat(bagian)));
    req.on("error", gagal);
  });
}
const json = (buf) => (buf.length ? JSON.parse(buf.toString()) : {});

// Jalankan fn(client) dalam transaksi sebagai role dari klaim (seperti harness pytest).
async function sebagai(klaim, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${klaim.role === "authenticated" ? "authenticated" : "anon"}`);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(klaim)]);
    const hasil = await fn(c);
    await c.query("commit");
    return hasil;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
const galatPg = (res, e) => kirim(res, 400, { message: e.message, code: e.code, details: e.detail ?? null, hint: e.hint ?? null });

// ---------- Auth ----------
const refreshTokens = new Map(); // token -> user id
function pengguna(u) {
  return { id: u.id, aud: "authenticated", role: "authenticated", email: u.email, app_metadata: { provider: "email" },
    user_metadata: u.raw_user_meta_data || {}, created_at: u.created_at, updated_at: u.created_at };
}
function sesi(u, req) {
  const aal2 = req.headers["x-uji-aal2"] === "1" || /^pemilik/.test(u.email);
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const refresh_token = crypto.randomBytes(16).toString("hex");
  refreshTokens.set(refresh_token, u.id);
  return { access_token: jwt({ sub: u.id, role: "authenticated", aal: aal2 ? "aal2" : "aal1", email: u.email, exp }),
    token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token, user: pengguna(u) };
}
const ambilUser = async (where, nilai) =>
  (await pool.query(`select id, email, raw_user_meta_data, created_at from auth.users where ${where}`, nilai)).rows[0];

async function auth(req, res, url) {
  const rute = url.pathname.slice("/auth/v1".length);
  if (rute === "/token" && req.method === "POST") {
    const b = json(await bacaBody(req));
    let u;
    if (url.searchParams.get("grant_type") === "password") {
      u = await ambilUser("email = $1 and encrypted_password = extensions.crypt($2, encrypted_password)",
        [String(b.email || "").toLowerCase(), String(b.password || "")]);
      if (!u) return kirim(res, 400, { error: "invalid_grant", error_description: "Invalid login credentials",
        code: 400, msg: "Invalid login credentials" });
    } else if (url.searchParams.get("grant_type") === "refresh_token") {
      const id = refreshTokens.get(b.refresh_token);
      refreshTokens.delete(b.refresh_token);
      u = id && (await ambilUser("id = $1", [id]));
      if (!u) return kirim(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
    } else {
      return kirim(res, 400, { error: "unsupported_grant_type" });
    }
    return kirim(res, 200, sesi(u, req));
  }
  const klaim = klaimDari(req);
  if (rute === "/user" && req.method === "GET") {
    const u = klaim.sub && (await ambilUser("id = $1", [klaim.sub]));
    return u ? kirim(res, 200, pengguna(u)) : kirim(res, 401, { message: "invalid JWT", code: 401 });
  }
  if (rute === "/logout" && req.method === "POST") {
    for (const [t, id] of refreshTokens) if (id === klaim.sub) refreshTokens.delete(t);
    return kirim(res, 204);
  }
  return kirim(res, 404, { message: "tidak ada di server tiruan" });
}

// ---------- RPC ----------
const NAMA = /^[a-z_][a-z0-9_]*$/;
const putusRpc = new Map(); // fn -> sisa panggilan yang jawabannya dibuang (POST /__uji/putus-setelah-rpc {fn, kali})
async function rpc(req, res, fn) {
  if (!NAMA.test(fn)) return kirim(res, 404, { message: "fungsi tidak ada" });
  const args = json(await bacaBody(req));
  const nama = Object.keys(args);
  if (!nama.every((n) => NAMA.test(n))) return kirim(res, 400, { message: "nama argumen tidak sah" });
  const nilai = nama.map((n) => (args[n] === null ? null : typeof args[n] === "object" ? JSON.stringify(args[n]) : String(args[n])));
  const panggil = `public.${fn}(${nama.map((n, i) => `${n} => $${i + 1}`).join(", ")})`;
  try {
    const isi = await sebagai(klaimDari(req), async (c) => {
      const { rows: [f] } = await c.query(
        "select prorettype = 'void'::regtype as kosong from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace limit 1", [fn]);
      if (f?.kosong) { await c.query(`select ${panggil}`, nilai); return null; }
      return (await c.query(`select to_jsonb(${panggil}) as v`, nilai)).rows[0].v;
    });
    if (putusRpc.get(fn) > 0) { // uji: perubahan sudah tersimpan tetapi jawaban tidak sampai ke HP
      putusRpc.set(fn, putusRpc.get(fn) - 1);
      // Jawaban dipotong di tengah (bukan sekadar sambungan ditutup, supaya browser tidak mengulang sendiri).
      res.writeHead(200, { "content-type": "application/json", "content-length": 100000, "access-control-allow-origin": "*" });
      res.write("{");
      return setTimeout(() => res.socket.destroy(), 50);
    }
    return kirim(res, 200, isi);
  } catch (e) {
    return galatPg(res, e);
  }
}

// ---------- Storage ----------
const berkas = new Map(); // "bucket/path" -> {bytes, tipe}
// supabase-js mengirim Blob/File sebagai multipart/form-data (bagian berkas ber-filename); ambil isi aslinya.
function bagianBerkas(body, tipeHeader) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(tipeHeader || "");
  if (!m) return null;
  const batas = Buffer.from("--" + (m[1] || m[2]));
  let mulai = body.indexOf(batas);
  while (mulai >= 0) {
    const awal = mulai + batas.length;
    const berikut = body.indexOf(batas, awal);
    if (berikut < 0) break;
    const bagian = body.subarray(awal + 2, berikut - 2); // buang CRLF di depan dan belakang
    const sela = bagian.indexOf("\r\n\r\n");
    const kepala = bagian.subarray(0, sela).toString();
    if (/filename=/i.test(kepala)) {
      const t = /content-type:\s*([^\r\n]+)/i.exec(kepala);
      return { bytes: bagian.subarray(sela + 4), tipe: t ? t[1].trim() : "application/octet-stream" };
    }
    mulai = berikut;
  }
  return null;
}
async function storage(req, res, url) {
  const rute = decodeURIComponent(url.pathname.slice("/storage/v1/object/".length));
  const klaim = klaimDari(req);
  if (rute.startsWith("sign/")) {
    const [bucket, ...p] = rute.slice(5).split("/");
    const nama = p.join("/");
    if (req.method === "GET") {
      const t = bacaJwt(url.searchParams.get("token"));
      const f = berkas.get(`${bucket}/${nama}`);
      if (!t || t.url !== `${bucket}/${nama}` || !f) return kirim(res, 400, { message: "Invalid signature" });
      return kirim(res, 200, f.bytes, f.tipe);
    }
    const { expiresIn = 60 } = json(await bacaBody(req));
    try {
      const ada = await sebagai(klaim, async (c) =>
        (await c.query("select 1 from storage.objects where bucket_id = $1 and name = $2", [bucket, nama])).rowCount > 0);
      if (!ada) return kirim(res, 400, { statusCode: "404", error: "not_found", message: "Object not found" });
      const token = jwt({ url: `${bucket}/${nama}`, exp: Math.floor(Date.now() / 1000) + Number(expiresIn) });
      return kirim(res, 200, { signedURL: `/object/sign/${encodeURI(`${bucket}/${nama}`)}?token=${token}` });
    } catch (e) {
      return galatPg(res, e);
    }
  }
  if (req.method !== "POST") return kirim(res, 404, { message: "tidak ada di server tiruan" });
  const [bucket, ...p] = rute.split("/");
  const nama = p.join("/");
  const mentah = await bacaBody(req);
  const isi = /^multipart\/form-data/i.test(req.headers["content-type"] || "")
    ? bagianBerkas(mentah, req.headers["content-type"]) : null;
  const bytes = isi ? isi.bytes : mentah;
  const tipe = isi ? isi.tipe : req.headers["content-type"] || "application/octet-stream";
  try {
    const id = await sebagai(klaim, async (c) => (await c.query(
      "insert into storage.objects(bucket_id, name, owner, metadata) values ($1, $2, $3, $4) returning id",
      [bucket, nama, klaim.sub ?? null, JSON.stringify({ size: bytes.length, mimetype: tipe })])).rows[0].id);
    berkas.set(`${bucket}/${nama}`, { bytes, tipe });
    return kirim(res, 200, { Id: id, Key: `${bucket}/${nama}` });
  } catch (e) {
    return kirim(res, 400, { statusCode: "403", error: "Unauthorized", message: e.message });
  }
}

// ---------- Statis ----------
const TIPE = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".mjs": "application/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".ico": "image/x-icon", ".webp": "image/webp", ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json" };
function statis(req, res, url) {
  let f = path.join(WEB, decodeURIComponent(url.pathname));
  if (f !== WEB && !f.startsWith(WEB + path.sep)) return kirim(res, 403, { message: "dilarang" });
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, "index.html");
  if (!fs.existsSync(f)) return kirim(res, 404, "tidak ada", "text/plain");
  kirim(res, 200, fs.readFileSync(f), TIPE[path.extname(f)] || "application/octet-stream");
}

// ---------- Server ----------
let offline = false;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    if (url.pathname === "/__uji/offline" && req.method === "POST") {
      offline = Boolean(json(await bacaBody(req)).on);
      return kirim(res, 200, { offline });
    }
    if (url.pathname === "/__uji/berkas" && req.method === "GET") { // isi berkas storage, untuk pemeriksaan uji
      const f = berkas.get(url.searchParams.get("path"));
      return f ? kirim(res, 200, f.bytes, f.tipe) : kirim(res, 404, { message: "tidak ada" });
    }
    if (url.pathname === "/__uji/putus-setelah-rpc" && req.method === "POST") {
      const { fn, kali = 1 } = json(await bacaBody(req));
      putusRpc.set(fn, kali);
      return kirim(res, 200, { fn, kali });
    }
    const api = /^\/(auth|rest|storage)\/v1\//.test(url.pathname);
    if (api && offline) return req.socket.destroy();
    if (req.method === "OPTIONS") {
      res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS" });
      return res.end();
    }
    if (url.pathname.startsWith("/auth/v1/")) return await auth(req, res, url);
    const m = url.pathname.match(/^\/rest\/v1\/rpc\/([^/]+)$/);
    if (m && req.method === "POST") return await rpc(req, res, m[1]);
    if (url.pathname.startsWith("/storage/v1/object/")) return await storage(req, res, url);
    if (api) return kirim(res, 404, { message: "tidak ada di server tiruan" });
    if (req.method === "GET" || req.method === "HEAD") return statis(req, res, url);
    kirim(res, 405, { message: "metode tidak didukung" });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) kirim(res, 500, { message: String(e.message || e) });
  }
});
server.listen(Number(opsi.port), "127.0.0.1", () => {
  console.log(`siap http://127.0.0.1:${server.address().port}`);
});
const henti = () => { server.closeAllConnections(); server.close(() => pool.end().then(() => process.exit(0))); };
process.on("SIGTERM", henti);
process.on("SIGINT", henti);
