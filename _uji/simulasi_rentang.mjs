// Simulasi ±3 bulan penjualan Kasir Koi di database UJI lokal (tidak pernah menyentuh Supabase asli),
// lalu tangkapan layar laporan pemilik di ukuran iPhone dan ringkasan angka.
//
//   cd _uji && node simulasi_rentang.mjs [folder-keluaran]
//
// Rentang data: tanggal 1 dua bulan sebelum bulan ini (WITA) s.d. kemarin. Data dibuat dengan PRNG berbenih
// (hasil sama untuk tanggal jalan yang sama). Nota dimasukkan langsung oleh pembuat database karena pos_checkout
// menolak nota lebih dari 3 hari; kolomnya diisi seperti pos_checkout (nomor nota, server_total, kode klaim berupa hash,
// shift + serah terima laci, void lewat pengajuan yang disetujui pemilik), jadi pos_report / pos_report_range menghitung
// dari data yang konsisten. Foto bukti nota yang tampil di layar Setujui diunggah lewat server tiruan.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { chromium, jalankanServer, masuk, rpcSebagai, SANDI, siapkanDb } from "./e2e/bantu.mjs";

const KELUAR = path.resolve(process.argv[2] || "/home/user/CLAUDE/rancangan/simulasi");
mkdirSync(KELUAR, { recursive: true });

// ---------- PRNG berbenih (mulberry32) ----------
let benih = 20261129;
const acak = () => { benih |= 0; benih = (benih + 0x6d2b79f5) | 0; let t = Math.imul(benih ^ (benih >>> 15), 1 | benih);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const antara = (a, b) => a + Math.floor(acak() * (b - a + 1));
const pilihBobot = (daftar) => { let r = acak() * daftar.reduce((s, x) => s + x[1], 0);
  for (const x of daftar) { r -= x[1]; if (r < 0) return x[0]; } return daftar[daftar.length - 1][0]; };
const uuid = () => { const b = Array.from({ length: 16 }, () => antara(0, 255)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };

// ---------- Tanggal WITA ----------
const hariWita = (geser = 0) => new Date(Date.now() + 8 * 3600e3 + geser * 86400e3).toISOString().slice(0, 10);
const tambahHari = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const HARI_INI = hariWita(), KEMARIN = hariWita(-1);
const AWAL = (() => { const d = new Date(HARI_INI.slice(0, 8) + "01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 10); })();
const BULAN_LALU = (() => { const d = new Date(HARI_INI.slice(0, 8) + "01T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })();
const AKHIR_BULAN_LALU = tambahHari(HARI_INI.slice(0, 8) + "01", -1);
const jam = (tgl, menit) => new Date(`${tgl}T00:00:00+08:00`).getTime() + menit * 60e3; // ms epoch
const isoMs = (ms) => new Date(ms).toISOString();

// ---------- Menu ----------
const MENU = [
  ["Teh Tarik", "Minuman", [["14 oz", 15000], ["22 oz", 22000]], 30],
  ["Milo Tarik", "Minuman", [["14 oz", 18000], ["22 oz", 25000]], 15],
  ["Matcha Tarik", "Minuman", [["14 oz", 20000], ["22 oz", 28000]], 15],
  ["Houjicha Tarik", "Minuman", [["14 oz", 20000], ["22 oz", 28000]], 9],
  ["Bagel", "Makanan", [["Biasa", 18000]], 14],
  ["Wrap", "Makanan", [["Biasa", 22000]], 12],
];
const ALASAN = ["Salah input", "Pelanggan batal", "Salah pilih ukuran", "Pelanggan minta ganti menu", "Dobel input"];

async function siapkanMenu(sql) {
  // data contoh harness: Teh Tarik 14/22, Milo Tarik 14 -> lengkapi
  const varian = {};
  for (const [i, [nama, kat, vs]] of MENU.entries()) {
    let item = (await sql.query("select id from pos_items where name = $1", [nama])).rows[0]?.id;
    if (!item) item = (await sql.query("insert into pos_items(name, category, sort) values ($1, $2, $3) returning id", [nama, kat, i + 1])).rows[0].id;
    for (const [v, harga] of vs) {
      let id = (await sql.query("select id from pos_variants where item_id = $1 and name = $2", [item, v])).rows[0]?.id;
      if (!id) id = (await sql.query("insert into pos_variants(item_id, name, price) values ($1, $2, $3) returning id", [item, v, harga])).rows[0].id;
      varian[`${nama}|${v}`] = { id: Number(id), item: nama, variant: v, price: harga };
    }
  }
  await sql.query("delete from pos_price_history");
  await sql.query("insert into pos_price_history(variant_id, price, valid_from) select id, price, $1::timestamptz from pos_variants",
    [isoMs(jam(AWAL, 0) - 30 * 86400e3)]);
  return varian;
}

async function isi(sql) {
  const varian = await siapkanMenu(sql);
  const staf = Object.fromEntries((await sql.query("select name, user_id from kk_staff")).rows.map((r) => [r.name, r.user_id]));
  const metode = Object.fromEntries((await sql.query("select kind, id from pos_pay_methods")).rows.map((r) => [r.kind, Number(r.id)]));
  const dTeman = (await sql.query("insert into pos_discounts(name, kind, value) values ('Teman 10%', 'persen', 10) returning id")).rows[0].id;
  const dPotong = (await sql.query("insert into pos_discounts(name, kind, value) values ('Potong 5rb', 'rupiah', 5000) returning id")).rows[0].id;
  const tLama = jam(KEMARIN, 18 * 60);
  await sql.query(`insert into pos_devices(id, label, requested_by, requested_at, approved_by, approved_at, revoked_at) values
    ('hp-kasir-1', 'HP Kasir', $1, $3, $2, $3, null), ('hp-lama', 'HP lama Ocha', $4, $3, $2, $3, $5)`,
    [staf.Budi, staf.Pemilik, isoMs(jam(AWAL, 0) - 86400e3), staf.Ocha, isoMs(tLama)]);
  // 260 member Kolam Koi (pemicu kk_on_signup membuat kk_members)
  await sql.query(`insert into auth.users(email, raw_user_meta_data)
    select '6281300' || lpad(g::text, 5, '0') || '@member.tjapduakoi.id', jsonb_build_object('nickname', 'Teman ' || g)
    from generate_series(1, 260) g`);
  const member = (await sql.query("select user_id from kk_members order by phone")).rows.map((r) => r.user_id);

  const shifts = [], notas = [], lines = [], receipts = [], voids = [], audit = [], objects = [], counters = [];
  const klaimMember = new Map(); // member|kasir -> [waktu klaim]
  let shiftId = 0, laci = 300000;
  const istimewa = []; // nota yang fotonya diunggah lewat server (pengajuan batal tertunda, nota ditahan)

  for (let tgl = AWAL, hariKe = 0; tgl <= KEMARIN; tgl = tambahHari(tgl, 1), hariKe++) {
    const dow = new Date(tgl + "T00:00:00Z").getUTCDay(), tg = Number(tgl.slice(8));
    let n = dow === 0 || dow === 6 ? antara(30, 40) : dow === 5 ? antara(22, 30) : antara(15, 24);
    if (tg === 25 || tg === 1) n += 8; // gajian
    n = Math.min(n + Math.floor(hariKe / 30), 45); // makin dikenal
    const pagi = hariKe % 2 === 0 ? "Ocha" : "Budi", sore = pagi === "Ocha" ? "Budi" : "Ocha";
    const s1 = { id: ++shiftId, kasir: pagi, buka: jam(tgl, 8 * 60), tutup: jam(tgl, 14 * 60), modal: laci, handover: true };
    const s2 = { id: ++shiftId, kasir: sore, buka: jam(tgl, 14 * 60 + 5), tutup: jam(tgl, 21 * 60 + 30), handover: false, dari: s1.id };
    const waktu = Array.from({ length: n }, () => jam(tgl, antara(8 * 60 + 5, 21 * 60 + 20)) + antara(0, 59) * 1000).sort((a, b) => a - b);
    let urut = 0;
    const notaHari = [];
    for (const t of waktu) {
      const sh = t < s1.tutup ? s1 : s2, kasir = staf[sh.kasir], id = uuid();
      const isiKeranjang = new Map();
      for (let k = pilihBobot([[1, 60], [2, 30], [3, 10]]); k > 0; k--) {
        const [nama, , vs] = pilihBobot(MENU.map((m) => [m, m[3]]));
        const v = vs.length > 1 ? pilihBobot([[vs[0], 60], [vs[1], 40]]) : vs[0];
        const kunci = `${nama}|${v[0]}`;
        isiKeranjang.set(kunci, (isiKeranjang.get(kunci) || 0) + (acak() < 0.15 ? 2 : 1));
      }
      const baris = [...isiKeranjang].map(([k, q]) => ({ ...varian[k], qty: q }));
      const sub = baris.reduce((s, b) => s + b.qty * b.price, 0);
      let diskonId = null, diskon = 0;
      if (acak() < 0.04) { if (acak() < 0.7) { diskonId = dTeman; diskon = Math.floor(sub * 10 / 100); } else { diskonId = dPotong; diskon = Math.min(5000, sub); } }
      const server = sub - diskon;
      const kind = pilihBobot([["tunai", 60], ["qris", 35], ["transfer", 5]]);
      const offline = acak() < 0.02;
      const beda = offline && notas.filter((x) => x.price_mismatch).length < 2 && acak() < 0.5;
      const total = beda ? server - 3000 : server;
      let terima = null, kembali = null;
      if (kind === "tunai") { terima = pilihBobot([[total, 30], [Math.ceil(total / 10000) * 10000, 30], [Math.max(50000, Math.ceil(total / 50000) * 50000), 30], [100000 * Math.ceil(total / 100000), 10]]); kembali = terima - total; }
      const no = `K${tgl.slice(2, 4)}${tgl.slice(5, 7)}${tgl.slice(8)}-${String(++urut).padStart(3, "0")}`;
      const foto = `${kasir}/${id}.jpg`;
      const hp = acak() < 0.3 ? `62812${antara(10000000, 99999999)}` : null;
      const nota = { id, no, cashier: kasir, device: "hp-kasir-1", shift_id: sh.id, client_at: isoMs(t),
        received_at: isoMs(offline ? t + antara(5, 40) * 60e3 : t + 1500), offline, subtotal: sub, discount_id: diskonId,
        discount_amt: diskon, total, server_total: server, price_mismatch: total !== server, method_id: metode[kind],
        cash_received: terima, change: kembali, photo_path: foto, customer_phone: hp, voucher_code: null, status: "lunas",
        voided_at: null, held: false, discount_inactive: false, method_inactive: false, _kind: kind, _baris: baris, _sh: sh };
      notas.push(nota); notaHari.push(nota);
      for (const b of baris) lines.push({ nota_id: id, variant_id: b.id, item_name: b.item, variant_name: b.variant, qty: b.qty, price: b.price, free: false });
      receipts.push({ nota: no, total: Math.min(total, server), created_by: kasir, created_at: nota.received_at,
        code_hash: crypto.createHash("sha256").update(id).digest("hex"), bound_phone: hp,
        expires_at: isoMs(Date.parse(nota.received_at) + (hp ? 7 * 86400e3 : 2 * 3600e3)), voided_at: null, pos_nota_id: id,
        held: false, claimed_by: null, claimed_at: null });
      objects.push({ bucket_id: "bukti", name: foto, owner: kasir, created_at: nota.received_at, metadata: { size: antara(28000, 41000), mimetype: "image/jpeg" } });
      if (diskonId) audit.push({ tbl: "pos_notas", row_id: id, action: "diskon", old: null,
        new: { no, discount_id: Number(diskonId), name: diskonId === dTeman ? "Teman 10%" : "Potong 5rb", amount: diskon }, by_user: kasir, at: nota.received_at, source: "app" });
    }
    counters.push({ day: tgl, seq: urut });
    // void ±1 tiap 3 hari (disetujui pemilik)
    if (acak() < 0.33 && notaHari.length) {
      const v = notaHari[antara(0, notaHari.length - 1)];
      const tAju = Date.parse(v.client_at) + antara(2, 15) * 60e3, tPutus = tAju + antara(10, 90) * 60e3;
      v.status = "batal"; v.voided_at = isoMs(tPutus);
      const alasan = ALASAN[antara(0, ALASAN.length - 1)];
      voids.push({ nota_id: v.id, reason: alasan, requested_by: v.cashier, requested_at: isoMs(tAju), decided_by: staf.Pemilik,
        decided_at: isoMs(tPutus), approved: true, cards_note: null });
      receipts.find((r) => r.pos_nota_id === v.id).voided_at = isoMs(tPutus);
      audit.push({ tbl: "pos_notas", row_id: v.id, action: "void", old: { status: "lunas" },
        new: { status: "batal", nota: v.no, reason: alasan, cards_missing: [] }, by_user: staf.Pemilik, at: isoMs(tPutus), source: "app" });
    }
    // kemarin: satu pengajuan batal menunggu + satu nota offline dari HP yang dicabut (ditahan)
    if (tgl === KEMARIN) {
      const cand = notaHari.filter((x) => x.status === "lunas" && x._sh === s2 && !x.offline);
      const p = cand[cand.length - 1];
      voids.push({ nota_id: p.id, reason: "Pelanggan minta ganti menu", requested_by: p.cashier,
        requested_at: isoMs(Date.parse(p.client_at) + 4 * 60e3), decided_by: null, decided_at: null, approved: null, cards_note: null });
      istimewa.push(p);
      const h = notaHari.filter((x) => x.status === "lunas" && x.cashier === staf.Ocha && Date.parse(x.client_at) < tLama && !x.offline).pop();
      if (h) { h.held = true; h.offline = true; h.device = "hp-lama"; h.received_at = isoMs(tLama + 50 * 60e3);
        const r = receipts.find((x) => x.pos_nota_id === h.id); r.held = true; r.created_at = h.received_at; istimewa.push(h); }
    }
    // laci: tunai lunas per shift + selisih sesekali
    const tunai = (sh) => notaHari.filter((x) => x._sh === sh && x.status === "lunas" && x._kind === "tunai").reduce((s, x) => s + x.total, 0);
    const selisih = () => (acak() < 0.12 ? pilihBobot([[-500, 2], [-1000, 3], [-2000, 3], [-5000, 1], [1000, 2], [2000, 1]]) : 0);
    s1.hitung = s1.modal + tunai(s1) + selisih();
    s2.modal = s1.hitung; s2.hitung = s2.modal + tunai(s2) + selisih();
    laci = s2.hitung;
    for (const s of [s1, s2]) {
      shifts.push({ id: s.id, cashier: staf[s.kasir], device: "hp-kasir-1", opened_at: isoMs(s.buka), cash_start: s.modal,
        received_from: s.dari || null, closed_at: isoMs(s.tutup), cash_counted: s.hitung, close_photo: `${staf[s.kasir]}/tutup-${s.id}.jpg`,
        handover: s.handover, received_count: s.handover ? s.hitung : null, received_by: s.handover ? staf[s2.kasir] : null,
        received_at: s.handover ? isoMs(s2.buka) : null });
    }
  }
  // klaim kode ±40%: paling banyak 2 nota dari kasir yang sama per member per 7 hari (supaya tidak ditandai mencurigakan)
  for (const r of receipts) {
    const n = notas.find((x) => x.id === r.pos_nota_id);
    if (n.status !== "lunas" || n.held || acak() >= 0.4) continue;
    const t = Date.parse(r.created_at) + antara(1, 30) * 60e3;
    for (let coba = 0; coba < 30; coba++) {
      const m = member[antara(0, member.length - 1)], k = `${m}|${r.created_by}`, w = (klaimMember.get(k) || []).filter((x) => x > t - 7 * 86400e3);
      if (w.length >= 2) continue;
      klaimMember.set(k, [...w, t]); r.claimed_by = m; r.claimed_at = isoMs(t); break;
    }
  }
  const bersih = (a) => a.map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_"))));
  const lewatFoto = new Set(istimewa.map((x) => x.photo_path));
  await sql.query("begin");
  await sql.query("insert into pos_shifts select * from jsonb_populate_recordset(null::pos_shifts, $1)", [JSON.stringify(shifts)]);
  await sql.query("select setval('pos_shifts_id_seq', (select max(id) from pos_shifts))");
  await sql.query("insert into pos_notas select * from jsonb_populate_recordset(null::pos_notas, $1)", [JSON.stringify(bersih(notas))]);
  await sql.query(`insert into pos_nota_lines(nota_id, variant_id, item_name, variant_name, qty, price, free)
    select nota_id, variant_id, item_name, variant_name, qty, price, free from jsonb_populate_recordset(null::pos_nota_lines, $1)`, [JSON.stringify(lines)]);
  await sql.query(`insert into kk_receipts(nota, total, created_by, created_at, claimed_by, claimed_at, code_hash, bound_phone, expires_at, voided_at, pos_nota_id, held)
    select nota, total, created_by, created_at, claimed_by, claimed_at, code_hash, bound_phone, expires_at, voided_at, pos_nota_id, held
    from jsonb_populate_recordset(null::kk_receipts, $1)`, [JSON.stringify(receipts)]);
  await sql.query(`insert into pos_void_requests(nota_id, reason, requested_by, requested_at, decided_by, decided_at, approved, cards_note)
    select nota_id, reason, requested_by, requested_at, decided_by, decided_at, approved, cards_note from jsonb_populate_recordset(null::pos_void_requests, $1)`, [JSON.stringify(voids)]);
  await sql.query(`insert into pos_audit(tbl, row_id, action, old, new, by_user, at, source)
    select tbl, row_id, action, old, new, by_user, at, source from jsonb_populate_recordset(null::pos_audit, $1)`, [JSON.stringify(audit)]);
  await sql.query(`insert into storage.objects(bucket_id, name, owner, created_at, metadata)
    select bucket_id, name, owner, created_at, metadata from jsonb_populate_recordset(null::storage.objects, $1)`,
    [JSON.stringify(objects.filter((o) => !lewatFoto.has(o.name)))]);
  await sql.query("insert into pos_counters select * from jsonb_populate_recordset(null::pos_counters, $1)", [JSON.stringify(counters)]);
  await sql.query(`update kk_members m set trx = c.n, spent = c.s from (select claimed_by, count(*) n, sum(total) s from kk_receipts
    where claimed_by is not null and voided_at is null group by 1) c where c.claimed_by = m.user_id`);
  await sql.query("commit");
  return { istimewa, jumlahNota: notas.length };
}

// Foto contoh nota (JPEG kecil bertuliskan isi nota) diunggah lewat server tiruan sebagai kasirnya.
async function unggahFoto(server, nota, email) {
  const dir = mkdtempSync(path.join(tmpdir(), "sim-foto-"));
  const f = path.join(dir, "nota.jpg");
  const teks = nota._baris.flatMap((b, i) => ["-annotate", `+30+${130 + i * 34}`, `${b.qty}x ${b.item} ${b.variant}  ${(b.qty * b.price).toLocaleString("id-ID")}`]);
  execFileSync("convert", ["-size", "480x420", "xc:#fffdf8", "-fill", "#222", "-pointsize", "26", "-annotate", "+30+60", "TJAP DUA KOI",
    "-pointsize", "16", "-annotate", "+30+90", `${nota.no}  (foto contoh simulasi)`, "-pointsize", "19", ...teks,
    "-pointsize", "22", "-annotate", `+30+${150 + nota._baris.length * 34 + 20}`, `TOTAL  ${nota.total.toLocaleString("id-ID")}`, "-quality", "70", f]);
  const t = await (await fetch(`${server.url}/auth/v1/token?grant_type=password`, { method: "POST",
    headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: SANDI }) })).json();
  const r = await fetch(`${server.url}/storage/v1/object/bukti/${nota.photo_path}`, { method: "POST",
    headers: { authorization: `Bearer ${t.access_token}`, "content-type": "image/jpeg" }, body: readFileSync(f) });
  if (!r.ok) throw new Error("unggah foto gagal: " + (await r.text()));
}

const rpS = (n) => "Rp" + Math.round(n).toLocaleString("id-ID");
const BULAN = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
const tglId = (s) => `${Number(s.slice(8))} ${BULAN[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
function ringkas(judul, d) {
  const sel = d.cash.total_selisih;
  return [`## ${judul}`, "", `${tglId(d.from)} sampai ${tglId(d.to)} (${d.days_count} hari)`, "",
    `- Omzet: **${rpS(d.omzet)}**`, `- Jumlah nota: **${d.notas}**`, `- Rata-rata per nota: ${rpS(d.avg)}`,
    `- Rata-rata per hari: ${rpS(d.avg_per_day)}`,
    `- Hari terbaik: ${d.best_day ? `${tglId(d.best_day.day)}, ${rpS(d.best_day.omzet)}` : "-"}`, "",
    "Per metode bayar:", ...d.by_method.map((m) => `- ${m.name}: ${rpS(m.total)} (${m.count} nota)`), "",
    "Per kasir:", ...d.by_cashier.map((c) => `- ${c.name}: ${rpS(c.total)} (${c.count} nota)`), "",
    "5 menu terlaris:", ...d.top_items.slice(0, 5).map((t, i) => `${i + 1}. ${t.item} ${t.variant}: ${t.qty} porsi, ${rpS(t.total)}`), "",
    `- Nota batal: ${d.voids.count} nota (${rpS(d.voids.total)})`,
    `- Diskon: ${d.discounts.count} nota (${rpS(d.discounts.total)})`,
    `- Selisih kas: ${sel === 0 ? "tidak ada" : (sel < 0 ? "kurang " : "lebih ") + rpS(Math.abs(sel))}, di ${d.cash.shifts_with_selisih} dari ${d.cash.shifts} shift`,
    `- Nota offline: ${d.offline.count}${d.offline.mismatch ? ` (${d.offline.mismatch} beda harga)` : ""}`,
    `- Kode klaim kartu: ${d.codes.claimed} dari ${d.codes.issued} sudah diklaim`, ""].join("\n");
}

async function main() {
  const db = await siapkanDb();
  const sql = new pg.Client({ connectionString: db.conninfo });
  await sql.connect();
  let server, browser;
  try {
    const { istimewa, jumlahNota } = await isi(sql);
    console.log(`data simulasi: ${AWAL} s.d. ${KEMARIN}, ${jumlahNota} nota`);
    server = await jalankanServer(db.conninfo);
    const emailStaf = Object.fromEntries((await sql.query("select k.user_id, u.email from kk_staff k join auth.users u on u.id = k.user_id")).rows.map((r) => [r.user_id, r.email]));
    for (const n of istimewa) await unggahFoto(server, n, emailStaf[n.cashier]);

    const bulan = await rpcSebagai(server, "pemilik@uji.id", "pos_report_range", { p_from: BULAN_LALU, p_to: AKHIR_BULAN_LALU });
    const semua = await rpcSebagai(server, "pemilik@uji.id", "pos_report_range", { p_from: AWAL, p_to: KEMARIN });

    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: "id-ID" });
    // rute sama seperti bukaHalaman (config.js ke server tiruan, tanpa font internet)
    await context.route(/^https:\/\/fonts\./, (r) => r.abort());
    await context.route("**/kasir/config.js", (r) => r.fulfill({ contentType: "application/javascript",
      body: `window.KASIR_CONFIG=${JSON.stringify({ supabaseUrl: server.url, supabaseKey: "uji-anon", kolamUrl: "https://tokotehtjapduakoi.github.io/kolam/", waNomor: "6281345306571" })};` }));
    const page = await context.newPage();
    await page.goto(server.url + "/kasir/");
    await masuk(page, "pemilik@uji.id");
    const tab = (nama) => page.locator("#tab").getByRole("button", { name: nama, exact: true });
    await tab("Laporan").waitFor();
    const device = await page.evaluate(() => localStorage.getItem("kasir.device"));
    await rpcSebagai(server, "pemilik@uji.id", "pos_device_decide", { p_device: device, p_approve: true });
    await page.reload();
    await tab("Laporan").click();
    const foto = async (nama) => { await page.waitForTimeout(400); await page.screenshot({ path: path.join(KELUAR, nama) }); console.log("tersimpan", nama); };
    await page.getByRole("button", { name: "Rentang", exact: true }).click();
    await page.getByRole("button", { name: "Bulan lalu" }).click();
    await page.locator("#rg-judul", { hasText: tglId(AKHIR_BULAN_LALU).split(" ").slice(1).join(" ") }).waitFor();
    await page.locator("#rg-judul").evaluate((e) => e.closest(".card").scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -8));
    await foto("01-rentang-bulan.png");
    await page.locator("#rg-grafik").scrollIntoViewIfNeeded();
    // rincian: dari "Per metode bayar" sampai akhir "Catatan" dalam satu gambar (halaman penuh, dipotong)
    const kotak = await page.evaluate(() => { const a = document.querySelector("#rg-grafik").closest(".card").nextElementSibling.getBoundingClientRect(),
      b = document.querySelector("#rg-catatan").getBoundingClientRect();
      return { x: 0, y: a.top + scrollY - 8, width: innerWidth, height: b.bottom - a.top + 16 }; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(KELUAR, "03-rentang-rincian.png"), fullPage: true, clip: kotak });
    console.log("tersimpan 03-rentang-rincian.png");
    await page.getByLabel("Dari").fill(AWAL);
    await page.getByLabel("Sampai").fill(KEMARIN);
    await page.getByRole("heading", { name: "Omzet per minggu" }).waitFor();
    await page.locator("#rg-judul").evaluate((e) => e.closest(".card").scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -8));
    await foto("02-rentang-panjang.png");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole("button", { name: "Harian", exact: true }).click();
    await page.getByLabel("Tanggal").fill(bulan.best_day.day);
    await page.locator("#lap-omzet", { hasText: rpS(bulan.best_day.omzet).replace(/\s/g, "") }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await foto("04-harian.png");
    await tab("Setujui").click();
    await page.locator(".kartu-void img.foto-nota").waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll(".foto-nota")].every((i) => i.complete && i.naturalWidth > 0));
    await page.evaluate(() => window.scrollTo(0, 0));
    await foto("05-setujui.png");
    await context.close();

    writeFileSync(path.join(KELUAR, "RINGKASAN.md"), [
      "# Ringkasan simulasi Kasir Koi", "",
      "> **DATA SIMULASI, bukan data asli.** Angka di bawah dibuat komputer secara acak (tetapi masuk akal) di database uji,",
      "> bukan dari Supabase toko. Tujuannya hanya untuk melihat bentuk laporan setelah toko jalan beberapa bulan.", "",
      `Isi simulasi: ${tglId(AWAL)} sampai ${tglId(KEMARIN)}, 2 kasir (Ocha dan Budi, bergantian shift pagi dan sore),`,
      "menu Teh/Milo/Matcha/Houjicha Tarik 14 oz dan 22 oz, Bagel, Wrap; bayar Tunai, QRIS, Transfer bank.",
      "Sabtu-Minggu dan tanggal gajian (1 dan 25) dibuat lebih ramai. Uang laci tidak diambil pemilik (modal = hitungan kemarin).", "",
      ringkas(`Bulan lalu (${BULAN[Number(BULAN_LALU.slice(5, 7)) - 1]} ${BULAN_LALU.slice(0, 4)})`, bulan),
      ringkas("Seluruh simulasi", semua),
      "## Gambar layar", "",
      "- `01-rentang-bulan.png`: Laporan > Rentang > Bulan lalu (grafik per hari)",
      "- `02-rentang-panjang.png`: seluruh simulasi (grafik per minggu)",
      "- `03-rentang-rincian.png`: per metode bayar, per kasir, menu terlaris, catatan",
      `- \`04-harian.png\`: Laporan harian hari terbaik bulan lalu (${tglId(bulan.best_day.day)})`,
      "- `05-setujui.png`: tab Setujui (1 pengajuan batal menunggu, 1 nota ditahan dari HP yang dicabut)", ""].join("\n"));
    console.log("tersimpan RINGKASAN.md");
  } finally {
    if (browser) await browser.close();
    if (server) await server.tutup();
    await sql.end();
    await db.tutup();
  }
}
await main();
