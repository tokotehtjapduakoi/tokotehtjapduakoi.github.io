#!/usr/bin/env python3
"""Uji asap Kasir Koi terhadap project Supabase ASLI.

Hanya pustaka standar Python (urllib, json, hashlib, secrets).

  python3 _uji/asap_asli.py

Env:
  SUPABASE_URL              default: URL di kolam/config.js
  SUPABASE_PUBLISHABLE_KEY  default: kunci publishable di kolam/config.js (memang publik)
  SUPABASE_SERVICE_KEY      OPSIONAL. Kunci secret, hanya untuk menjalankan di luar environment
                            "CLAUDE" ini. Di environment ini JANGAN diisi: proxy jaringan
                            menyuntikkan kunci secret otomatis ke host project (request
                            "admin" dikirim TANPA header apikey). Kunci tidak pernah dicetak.

Yang dilakukan: membuat user uji sementara (uji-kasir-<acak>@uji.invalid, uji-pemilik-...,
member uji), menjalankan alur kasir (minta perangkat -> buka shift -> unggah foto ke
bukti/<uid>/ -> pos_checkout -> member daftar -> kk_claim_code -> cek tarikan -> tutup shift),
memeriksa bahwa anon/kasir tidak bisa memanggil fungsi atau membaca tabel yang dilarang,
lalu MENGHAPUS data uji di blok finally.

Batasan nyata (aal2 pemilik tidak bisa dipalsukan di Supabase asli):
  - fungsi khusus pemilik hanya diuji DITOLAK (pemilik aal1 dan kasir);
  - persetujuan perangkat dilakukan lewat tulis tabel service-role, bukan pos_device_decide;
  - void dan laporan (butuh aal2) tidak dijalankan sampai selesai.
Nota, baris nota, shift, dan menu yang dipakai nota DIKUNCI trigger (tidak bisa DELETE lewat REST).
Skrip menghapus semua yang bisa, menonaktifkan menu uji, dan mencetak SQL pembersih untuk
sisanya (jalankan di SQL Editor). Satu nomor urut nota hari itu terpakai (tidak bisa dikembalikan).
Skrip menolak jalan bila ada shift sungguhan yang sedang terbuka/menunggu serah terima.
"""
import hashlib
import json
import os
import re
import secrets
import sys
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone

DEF_URL = "https://trqjrhgtvvfviwcdhccp.supabase.co"
DEF_PUB = "sb_publishable_u1ddXj_2pbs27cqPpJi9Zg_Q78So7lr"  # kunci publishable: memang publik
URL = os.environ.get("SUPABASE_URL", DEF_URL).rstrip("/")
PUB = os.environ.get("SUPABASE_PUBLISHABLE_KEY", DEF_PUB)
SVC = os.environ.get("SUPABASE_SERVICE_KEY", "")
ALFABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300"
    + "ff" * 64
    + "ffc0000b080001000101011100ffc4001400010000000000000000000000000000000000ffda0008010100003f00d2cf20ffd9")

HASIL = []  # (nama, lulus, catatan)
RAND = secrets.token_hex(3)


def cek(nama, ok, catatan=""):
    HASIL.append((nama, bool(ok), catatan))
    print(("  PASS  " if ok else "  FAIL  ") + nama + (f"  [{catatan}]" if catatan and not ok else ""))
    return ok


def http(method, path, body=None, token=None, service=False, raw=None, ctype=None, extra=None):
    """Kembalikan (status, data). service=True: tanpa apikey (proxy menyuntik) atau SUPABASE_SERVICE_KEY."""
    h = {}
    if service:
        if SVC:
            h["apikey"] = SVC
            if SVC.startswith("eyJ"):
                h["Authorization"] = "Bearer " + SVC
    else:
        h["apikey"] = PUB
        if token:
            h["Authorization"] = "Bearer " + token
    data = raw
    if body is not None:
        data = json.dumps(body).encode()
        h["Content-Type"] = "application/json"
    if ctype:
        h["Content-Type"] = ctype
    if extra:
        h.update(extra)
    req = urllib.request.Request(URL + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode() or ""
            code = r.status
    except urllib.error.HTTPError as e:
        txt = e.read().decode() or ""
        code = e.code
    try:
        return code, json.loads(txt) if txt else None
    except ValueError:
        return code, txt


def svc(method, path, body=None, prefer="return=representation"):
    return http(method, "/rest/v1/" + path, body, service=True, extra={"Prefer": prefer})


def rpc(fn, args=None, token=None):
    return http("POST", "/rest/v1/rpc/" + fn, args or {}, token=token)


def ditolak(res):
    """Panggilan tidak boleh sukses: status >= 400 (izin/peran) dianggap ditolak."""
    return res[0] >= 400


def pesan(res):
    d = res[1]
    return (d.get("message") if isinstance(d, dict) else str(d))[:160] if d else ""


def buat_user(email, password):
    c, d = http("POST", "/auth/v1/admin/users", {"email": email, "password": password, "email_confirm": True}, service=True)
    if c >= 300:
        raise RuntimeError(f"Gagal membuat user uji {email}: {c} {d}")
    return d["id"]


def masuk(email, password):
    c, d = http("POST", "/auth/v1/token?grant_type=password", {"email": email, "password": password})
    if c != 200:
        raise RuntimeError(f"Gagal masuk {email}: {c} {d}")
    return d["access_token"]


def kode_acak():
    return "".join(secrets.choice(ALFABET) for _ in range(10))


def main():
    print(f"Uji asap Kasir Koi -> {URL}")
    sandi = secrets.token_urlsafe(18)
    users = {}      # nama -> uid
    dibuat = {"devices": [], "storage": [], "items": [], "methods": [], "nota": [], "shift": [], "variants": []}
    phone_member = "6299" + "".join(secrets.choice("0123456789") for _ in range(8))
    phone_kasir = "6298" + "".join(secrets.choice("0123456789") for _ in range(8))
    mail_kasir = f"uji-kasir-{RAND}@uji.invalid"
    mail_pemilik = f"uji-pemilik-{RAND}@uji.invalid"
    mail_member = f"{phone_member}@member.tjapduakoi.id"
    try:
        # ---- 0. Prasyarat: jangan ganggu operasional sungguhan ----
        c, d = svc("GET", "pos_shifts?select=id&or=(closed_at.is.null,and(handover.is.true,received_at.is.null))&limit=1")
        if c != 200:
            cek("Akses service ke tabel pos_shifts (proxy menyuntik kunci secret?)", False, f"{c} {d}")
            return
        if d:
            cek("Tidak ada shift sungguhan terbuka/menunggu", False, "ada shift aktif: jalankan uji di luar jam jual")
            return
        cek("Tidak ada shift sungguhan terbuka/menunggu", True)

        # ---- 1. User uji ----
        users["kasir"] = buat_user(mail_kasir, sandi)
        users["pemilik"] = buat_user(mail_pemilik, sandi)
        c, d = svc("POST", "kk_staff", [
            {"user_id": users["kasir"], "role": "kasir", "name": "UJI kasir", "phone": phone_kasir},
            {"user_id": users["pemilik"], "role": "pemilik", "name": "UJI pemilik"}])
        cek("Staf uji terdaftar (service)", c in (200, 201), f"{c} {d}")
        tk = masuk(mail_kasir, sandi)
        tp = masuk(mail_pemilik, sandi)

        # ---- 2. Fungsi pemilik harus ditolak (kasir; pemilik aal1) ----
        for nama, fn, args, tok in [
            ("pos_devices_list ditolak untuk kasir", "pos_devices_list", {}, tk),
            ("pos_devices_list ditolak untuk pemilik aal1", "pos_devices_list", {}, tp),
            ("pos_report ditolak untuk pemilik aal1", "pos_report", {}, tp),
            ("pos_catalog_all ditolak untuk pemilik aal1", "pos_catalog_all", {}, tp),
            ("pos_void_decide ditolak untuk kasir", "pos_void_decide", {"p_req": 1, "p_approve": True}, tk),
            ("pos_item_save ditolak untuk pemilik aal1", "pos_item_save", {"p": {"name": "x"}}, tp)]:
            r = rpc(fn, args, tok)
            cek(nama, ditolak(r), f"{r[0]} {pesan(r)}" if not ditolak(r) else "")

        # ---- 3. Menu uji (service) ----
        c, d = svc("POST", "pos_items", {"name": f"UJI-{RAND}", "category": "UJI", "active": True})
        if not cek("Menu uji dibuat", c in (200, 201) and d, f"{c} {d}"):
            return
        item_id = d[0]["id"]
        dibuat["items"].append(item_id)
        c, d = svc("POST", "pos_variants", {"item_id": item_id, "name": "uji", "price": 20000, "active": True})
        var_id = d[0]["id"]
        dibuat["variants"].append(var_id)
        c, d = svc("GET", "pos_pay_methods?select=id&kind=eq.tunai&active=is.true&limit=1")
        if d:
            metode = d[0]["id"]
        else:
            c, d = svc("POST", "pos_pay_methods", {"name": f"UJI tunai {RAND}", "kind": "tunai"})
            metode = d[0]["id"]
            dibuat["methods"].append(metode)

        # ---- 4. Alur kasir ----
        dev = secrets.token_hex(16)
        dibuat["devices"].append(dev)
        r = rpc("pos_device_request", {"p_device": dev, "p_label": "UJI HP"}, tk)
        cek("Minta perangkat -> pending", r[0] == 200 and r[1] == "pending", f"{r[0]} {pesan(r)} {r[1]}")
        r = rpc("pos_shift_open", {"p_device": dev, "p_cash_start": 0}, tk)
        cek("Buka shift ditolak sebelum perangkat disetujui", ditolak(r), "")
        r = rpc("pos_catalog", {}, tk)
        cek("Kasir bisa memuat katalog (pos_catalog)", r[0] == 200 and isinstance(r[1], dict) and "items" in r[1], f"{r[0]} {pesan(r)}")
        # Persetujuan oleh pemilik butuh aal2 (tidak bisa dipalsukan): setujui lewat tulis service.
        c, d = svc("PATCH", f"pos_devices?id=eq.{dev}", {"approved_by": users["pemilik"], "approved_at": datetime.now(timezone.utc).isoformat()})
        cek("Perangkat disetujui (tulis service, bukan aal2)", c == 200 and d, f"{c} {d}")
        r = rpc("pos_shift_open", {"p_device": dev, "p_cash_start": 0}, tk)
        if r[0] != 200:  # cadangan: buka lewat tulis service (aturan pengendali)
            c, d = svc("POST", "pos_shifts", {"cashier": users["kasir"], "device": dev, "cash_start": 0})
            cek("Buka shift lewat tulis service (cadangan)", c in (200, 201), f"{c} {d}; rpc: {pesan(r)}")
            shift_id = d[0]["id"] if c in (200, 201) and d else None
        else:
            cek("Buka shift (pos_shift_open)", True)
            shift_id = r[1]["id"]
        dibuat["shift"].append(shift_id)

        def unggah(nama):
            path = f"{users['kasir']}/{nama}"
            c, d = http("POST", "/storage/v1/object/bukti/" + path, token=tk, raw=JPEG, ctype="image/jpeg")
            dibuat["storage"].append(path)
            return c, d, path
        c, d, foto1 = unggah(f"uji-{RAND}-1.jpg")
        cek("Unggah foto ke bukti/<uid>/ sebagai kasir", c in (200, 201), f"{c} {d}")
        c2, d2 = http("POST", f"/storage/v1/object/bukti/{users['pemilik']}/x-{RAND}.jpg", token=tk, raw=JPEG, ctype="image/jpeg")
        cek("Unggah ke folder orang lain ditolak", c2 >= 400, f"{c2}")

        nota_id = str(uuid.uuid4())
        kode = kode_acak()
        payload = {"id": nota_id, "device": dev, "client_at": datetime.now(timezone.utc).isoformat(), "offline": False,
                   "lines": [{"variant_id": var_id, "qty": 1}], "method_id": metode, "total": 20000,
                   "cash_received": 20000, "photo_path": foto1, "customer_phone": phone_member, "code": kode}
        r = rpc("pos_checkout", {"p": payload}, tk)
        ok = r[0] == 200 and isinstance(r[1], dict)
        # Berhasil = pos_checkout (security definer) melihat storage.objects lewat pos__photo_ok.
        cek("pos_checkout sukses (membuktikan security definer melihat storage.objects)", ok, f"{r[0]} {pesan(r)}")
        if not ok:
            return
        dibuat["nota"].append(nota_id)
        nota_no = r[1]["no"]
        cek("Nota punya 1 tarikan & kode aktif", r[1].get("pulls") == 1 and r[1].get("code_status") == "aktif", json.dumps(r[1]))
        r2 = rpc("pos_checkout", {"p": payload}, tk)
        cek("Kirim ulang id sama idempoten (no sama)", r2[0] == 200 and r2[1].get("no") == nota_no, f"{r2[0]} {pesan(r2)}")
        c, d = svc("GET", f"kk_receipts?select=code_hash,total,bound_phone&pos_nota_id=eq.{nota_id}")
        h = hashlib.sha256(kode.encode()).hexdigest()
        cek("Server hanya menyimpan hash kode (bukan kode)", c == 200 and d and d[0]["code_hash"] == h and kode not in json.dumps(d))

        # ---- 5. Member klaim ----
        c, d = http("POST", "/auth/v1/signup", {"email": mail_member, "password": sandi, "data": {"nickname": "UJI"}})
        cek("Member daftar", c in (200, 201), f"{c} {d}")
        tm = masuk(mail_member, sandi)
        c, d = svc("GET", f"kk_members?select=user_id&phone=eq.{phone_member}")
        users["member"] = d[0]["user_id"] if d else None
        r = rpc("kk_claim_code", {"p_code": kode[:5] + "-" + kode[5:]}, tm)
        cek("kk_claim_code sukses (status ok)", r[0] == 200 and isinstance(r[1], dict) and r[1].get("status") == "ok", f"{r[0]} {r[1]}")
        c, d = svc("GET", f"kk_pulls?select=id&member_id=eq.{users['member']}")
        cek("Tarikan tercatat di kk_pulls (1)", c == 200 and len(d) == 1, f"{c} {d}")
        r = rpc("kk_claim_code", {"p_code": kode}, tm)
        cek("Klaim kedua ditolak (status used)", r[0] == 200 and r[1].get("status") == "used", f"{r[0]} {r[1]}")
        r = rpc("pos_catalog", {}, tm)
        cek("Member biasa tidak bisa pos_catalog", ditolak(r))
        r = rpc("pos_checkout", {"p": payload}, tm)
        cek("Member biasa tidak bisa pos_checkout", ditolak(r))

        # ---- 6. Kasir: akses tabel terlarang ----
        c, d = http("GET", "/rest/v1/pos_notas?select=id", token=tk)
        cek("Kasir tidak bisa select pos_notas langsung", c >= 400 or d == [], f"{c} {d}")
        r = rpc("pos_void_request", {"p_nota": nota_id, "p_reason": "uji"}, tk)
        cek("Kasir bisa mengajukan void (pos_void_request)", r[0] == 200, f"{r[0]} {pesan(r)}")
        r = rpc("pos_void_pending", {}, tk)
        cek("Kasir tidak bisa pos_void_pending (pemilik)", ditolak(r))

        # ---- 7. Tutup shift (agar laci sungguhan tidak tertahan) ----
        c, d, foto2 = unggah(f"uji-{RAND}-2.jpg")
        r = rpc("pos_shift_close", {"p_cash_counted": 20000, "p_photo_path": foto2, "p_handover": False}, tk)
        cek("Tutup shift (tutup toko)", r[0] == 200, f"{r[0]} {pesan(r)}")

        # ---- 8. anon ----
        for nama, fn, args in [("pos_catalog", "pos_catalog", {}), ("pos_checkout", "pos_checkout", {"p": payload}),
                               ("pos_me", "pos_me", {"p_device": dev}), ("pos_report", "pos_report", {})]:
            r = rpc(fn, args)
            cek(f"anon tidak bisa memanggil {nama}", ditolak(r), f"{r[0]}")
        for tbl in ["pos_notas", "pos_nota_lines", "pos_devices", "pos_audit", "kk_staff", "kk_members"]:
            c, d = http("GET", f"/rest/v1/{tbl}?select=*&limit=1")
            cek(f"anon tidak bisa membaca {tbl}", c >= 400 or d == [], f"{c} {str(d)[:80]}")
        c, d = http("GET", "/rest/v1/kk_receipts?select=code_hash&limit=1")
        cek("anon tidak bisa select kk_receipts.code_hash", c >= 400, f"{c} {str(d)[:80]}")
        c, d = http("GET", "/rest/v1/kk_receipts?select=code_hash&limit=1", token=tk)
        cek("kasir tidak bisa select kk_receipts.code_hash", c >= 400, f"{c} {str(d)[:80]}")
        c, d = http("GET", f"/storage/v1/object/authenticated/bukti/{foto1}")
        cek("anon tidak bisa membaca foto bukti", c >= 400, f"{c}")
    except Exception as e:  # noqa: BLE001
        cek("Skrip berjalan tanpa error tak terduga", False, repr(e))
    finally:
        print("\nMembersihkan data uji...")
        sisa = bersihkan(users, dibuat)
        ringkas(sisa, users, dibuat)


def bersihkan(users, dibuat):
    """Hapus semua yang bisa. Kembalikan daftar sisa (terkunci trigger) untuk SQL pembersih."""
    uids = [u for u in users.values() if u]
    sisa = []

    def hapus(ket, path):
        c, d = svc("DELETE", path, prefer="return=minimal")
        ok = c in (200, 204)
        print(("  ok    " if ok else "  GAGAL ") + ket + ("" if ok else f" [{c} {str(d)[:100]}]"))
        return ok
    ins = lambda xs: "in.(" + ",".join(str(x) for x in xs) + ")"  # noqa: E731
    if users.get("member"):
        m = users["member"]
        for t in ["kk_pulls", "kk_collection", "kk_inventory", "kk_exchanges"]:
            hapus(t, f"{t}?member_id=eq.{m}")
    if dibuat["nota"]:
        n = ins(dibuat["nota"])
        hapus("kk_receipts uji", f"kk_receipts?pos_nota_id={n}")
        hapus("pos_void_requests uji", f"pos_void_requests?nota_id={n}")
        # dikunci trigger: coba saja, sisanya lewat SQL
        if not hapus("pos_nota_lines uji (dikunci trigger)", f"pos_nota_lines?nota_id={n}"):
            sisa.append("lines")
        if not hapus("pos_notas uji (dikunci trigger)", f"pos_notas?id={n}"):
            sisa.append("notas")
    if uids:
        hapus("pos_audit uji", f"pos_audit?by_user={ins(uids)}")
    if dibuat["devices"]:
        hapus("pos_devices uji", f"pos_devices?id={ins(dibuat['devices'])}")
    sid = [s for s in dibuat["shift"] if s]
    if sid and "notas" in sisa:
        sisa.append("shift")
    elif sid:
        hapus("pos_shifts uji", f"pos_shifts?id={ins(sid)}")
    if dibuat["variants"]:
        if "lines" in sisa:
            for v in dibuat["variants"]:  # tidak bisa dihapus (baris nota merujuk): nonaktifkan
                svc("PATCH", f"pos_variants?id=eq.{v}", {"active": False})
            for i in dibuat["items"]:
                svc("PATCH", f"pos_items?id=eq.{i}", {"active": False})
            print("  ok    menu uji dinonaktifkan")
            sisa.append("menu")
        else:
            hapus("pos_price_history uji", f"pos_price_history?variant_id={ins(dibuat['variants'])}")
            hapus("pos_variants uji", f"pos_variants?id={ins(dibuat['variants'])}")
            hapus("pos_items uji", f"pos_items?id={ins(dibuat['items'])}")
    if dibuat["methods"]:
        hapus("pos_pay_methods uji", f"pos_pay_methods?id={ins(dibuat['methods'])}")
    for p in dibuat["storage"]:
        c, d = http("DELETE", "/storage/v1/object/bukti/" + p, service=True)
        print(("  ok    " if c in (200, 204) else "  GAGAL ") + f"storage {p}" + ("" if c in (200, 204) else f" [{c} {str(d)[:80]}]"))
    if uids:
        hapus("kk_staff uji", f"kk_staff?user_id={ins(uids)}")
    for nama, u in users.items():
        if not u:
            continue
        c, d = http("DELETE", f"/auth/v1/admin/users/{u}", service=True)
        print(("  ok    " if c in (200, 204) else "  GAGAL ") + f"auth user {nama}" + ("" if c in (200, 204) else f" [{c} {str(d)[:80]}]"))
    return sisa


def ringkas(sisa, users, dibuat):
    if sisa:
        n = ",".join(f"'{x}'" for x in dibuat["nota"])
        s = ",".join(str(x) for x in dibuat["shift"] if x)
        v = ",".join(str(x) for x in dibuat["variants"])
        i = ",".join(str(x) for x in dibuat["items"])
        print("\nSisa terkunci trigger. Jalankan di Supabase SQL Editor untuk membersihkan:\n")
        print("begin;\nalter table public.pos_notas disable trigger pos_nota_lock;\n"
              "alter table public.pos_nota_lines disable trigger pos_nota_lines_lock;")
        print(f"delete from public.pos_nota_lines where nota_id in ({n});")
        print(f"delete from public.pos_notas where id in ({n});")
        if s:
            print(f"delete from public.pos_shifts where id in ({s});")
        print(f"delete from public.pos_price_history where variant_id in ({v});")
        print(f"delete from public.pos_variants where id in ({v});\ndelete from public.pos_items where id in ({i});")
        print("alter table public.pos_notas enable trigger pos_nota_lock;\n"
              "alter table public.pos_nota_lines enable trigger pos_nota_lines_lock;\ncommit;\n")
    lulus = sum(1 for _, ok, _ in HASIL if ok)
    gagal = [(n, c) for n, ok, c in HASIL if not ok]
    print(f"\n=== {'PASS' if not gagal else 'FAIL'}: {lulus}/{len(HASIL)} pemeriksaan lulus"
          + (" · pembersihan SISA (lihat SQL di atas)" if sisa else " · data uji bersih") + " ===")
    for n, c in gagal:
        print(f"  - GAGAL: {n} {c}")
    sys.exit(0 if not gagal and not sisa else 1)


if __name__ == "__main__":
    main()
