"""Laporan rentang tanggal (pos_report_range): batas tengah malam WITA, ember grafik, validasi, hak akses."""
import json
import uuid

import pytest

from db import SqlError, aal2


class Rentang:
    """Pemilik + dua kasir; nota disisipkan langsung dengan client_at bebas (checkout menolak nota > 3 hari)."""

    def __init__(self, db):
        self.db = db
        self.pemilik = aal2(db.user("pemilik@x.id", peran="pemilik"))
        self.a = db.user("a@x.id", peran="kasir")
        self.b = db.user("b@x.id", peran="kasir")
        self.metode = dict(db.sql("select kind, id from pos_pay_methods"))
        item = db.sql("insert into pos_items(name) values ('Teh Tarik') returning id")[0][0]
        self.vid = db.sql(f"insert into pos_variants(item_id, name, price) values ({item}, '14 oz', 15000) returning id")[0][0]
        self.n = 0

    def shift(self, kasir, dibuka, modal=0, hitung=None):
        tutup = f"'{dibuka}'::timestamptz + interval '10 hours'" if hitung is not None else "null"
        return self.db.sql(
            f"insert into pos_shifts(cashier, device, opened_at, cash_start, closed_at, cash_counted, handover) "
            f"values ('{kasir['sub']}', 'dev1', '{dibuka}', {modal}, {tutup}, {'null' if hitung is None else hitung}, false) "
            f"returning id")[0][0]

    def nota(self, kasir, shift, waktu, total, kind="tunai", status="lunas", qty=None, offline=False,
             mismatch=False, diskon=0, kode=True, klaim=None):
        self.n += 1
        nid = str(uuid.uuid4())
        qty = qty or max(total // 15000, 1)
        self.db.sql(
            "insert into pos_notas(id, no, cashier, device, shift_id, client_at, offline, subtotal, discount_amt, total, "
            "server_total, price_mismatch, method_id, photo_path, status) values "
            f"('{nid}', 'R{self.n}', '{kasir['sub']}', 'dev1', {shift}, '{waktu}', {offline}, {total + diskon}, {diskon}, "
            f"{total}, {total + (1000 if mismatch else 0)}, {mismatch}, {self.metode[kind]}, 'f{self.n}', '{status}');"
            f"insert into pos_nota_lines(nota_id, variant_id, item_name, variant_name, qty, price) values "
            f"('{nid}', {self.vid}, 'Teh Tarik', '14 oz', {qty}, {total // qty})")
        if kode:
            self.db.sql(f"insert into kk_receipts(nota, total, pos_nota_id, claimed_by) values "
                        f"('R{self.n}', {total}, '{nid}', {f'{chr(39)}{klaim}{chr(39)}' if klaim else 'null'})")
        return nid


@pytest.fixture
def r(db):
    return Rentang(db)


def rentang(db, siapa, dari, sampai):
    return json.loads(db.sql(f"select pos_report_range('{dari}', '{sampai}')", sebagai=siapa)[0][0])


def test_rentang_lintas_bulan_batas_wita(db, r):
    s = r.shift(r.a, "2025-01-30 07:00+08", modal=100000, hitung=100000 + 15000 + 30000 + 15000 - 2000)
    s2 = r.shift(r.b, "2025-02-01 07:00+08", modal=0, hitung=0)
    m = db.member("6281200000001")["sub"]
    r.nota(r.a, s, "2025-01-30 23:59:59+08", 99000)                      # sebelum rentang
    r.nota(r.a, s, "2025-01-31 00:00:00+08", 15000, klaim=m)             # tengah malam awal: ikut
    r.nota(r.b, s2, "2025-01-31 12:00:00+08", 22000, kind="qris", offline=True, mismatch=True)
    r.nota(r.a, s, "2025-02-01 00:30:00+08", 30000, diskon=3000)         # 00.30 WITA = 31 Jan UTC: tetap 1 Feb
    r.nota(r.a, s, "2025-02-01 10:00:00+08", 45000, status="batal")      # batal: tidak dihitung penjualan
    r.nota(r.a, s, "2025-02-01 23:59:59+08", 15000)                      # akhir hari terakhir: ikut
    r.nota(r.a, s, "2025-02-02 00:00:00+08", 77000)                      # sesudah rentang
    x = rentang(db, r.pemilik, "2025-01-31", "2025-02-01")
    assert (x["from"], x["to"], x["days_count"], x["days_elapsed"], x["bucket"]) == ("2025-01-31", "2025-02-01", 2, 2, "day")
    assert (x["omzet"], x["notas"], x["avg"], x["avg_per_day"]) == (82000, 4, 20500, 41000)
    assert x["days"] == [{"day": "2025-01-31", "omzet": 37000, "notas": 2},
                         {"day": "2025-02-01", "omzet": 45000, "notas": 2}]
    assert x["best_day"] == {"day": "2025-02-01", "omzet": 45000}
    assert x["series"] == [{"label_start": "2025-01-31", "label_end": "2025-01-31", "omzet": 37000, "notas": 2},
                           {"label_start": "2025-02-01", "label_end": "2025-02-01", "omzet": 45000, "notas": 2}]
    assert x["by_method"] == [{"name": "Tunai", "total": 60000, "count": 3}, {"name": "QRIS", "total": 22000, "count": 1}]
    assert x["by_cashier"] == [{"name": "a@x.id", "total": 60000, "count": 3}, {"name": "b@x.id", "total": 22000, "count": 1}]
    assert x["top_items"][0]["item"] == "Teh Tarik"
    assert x["discounts"] == {"count": 1, "total": 3000}
    assert x["voids"] == {"count": 1, "total": 45000}
    assert x["offline"] == {"count": 1, "mismatch": 1, "held": 0}
    assert x["codes"] == {"issued": 4, "claimed": 1}
    # shift A dibuka 30 Jan (di luar rentang); shift B (1 Feb, tanpa selisih) ikut
    assert x["cash"] == {"shifts": 1, "total_selisih": 0, "shifts_with_selisih": 0, "ambil_total": 0, "tambah_total": 0, "moves_count": 0, "moves": []}
    y = rentang(db, r.pemilik, "2025-01-30", "2025-02-01")
    # seharusnya A = 100.000 + tunai lunas di shift A (99.000 + 15.000 + 30.000 + 15.000 + 77.000), hitungan jauh lebih kecil
    assert y["cash"]["shifts"] == 2 and y["cash"]["shifts_with_selisih"] == 1
    assert y["cash"]["total_selisih"] == (100000 + 58000) - (100000 + 99000 + 15000 + 30000 + 15000 + 77000)
    assert y["best_day"] == {"day": "2025-01-30", "omzet": 99000}
    # rentang satu hari = sama dengan laporan harian
    h = json.loads(db.sql("select pos_report('2025-02-01')", sebagai=r.pemilik)[0][0])
    z = rentang(db, r.pemilik, "2025-02-01", "2025-02-01")
    for k in ("omzet", "notas", "avg", "by_method", "by_cashier", "top_items", "discounts"):
        assert z[k] == h[k], k


def test_rentang_kosong(db, r):
    x = rentang(db, r.pemilik, "2020-03-01", "2020-03-03")
    assert (x["omzet"], x["notas"], x["avg"], x["avg_per_day"], x["best_day"]) == (0, 0, 0, 0, None)
    assert [d["omzet"] for d in x["days"]] == [0, 0, 0]
    assert [b["notas"] for b in x["series"]] == [0, 0, 0]
    assert x["cash"] == {"shifts": 0, "total_selisih": 0, "shifts_with_selisih": 0, "ambil_total": 0, "tambah_total": 0, "moves_count": 0, "moves": []}


def test_rentang_hari_hanya_sampai_hari_ini(db, r):
    kemarin, besok = db.sql("select ((now() at time zone 'Asia/Makassar')::date - 1)::text, "
                            "((now() at time zone 'Asia/Makassar')::date + 1)::text")[0]
    x = rentang(db, r.pemilik, kemarin, besok)
    assert (x["days_count"], x["days_elapsed"], len(x["days"]), len(x["series"])) == (3, 2, 2, 3)


@pytest.mark.parametrize("dari,sampai,ember,n,awal,akhir", [
    ("2025-01-01", "2025-03-03", "day", 62, ("2025-01-01", "2025-01-01"), ("2025-03-03", "2025-03-03")),
    # 63 hari: per minggu mulai Senin, minggu pertama dan terakhir dipotong ke rentang (1 Jan 2025 = Rabu)
    ("2025-01-01", "2025-03-04", "week", 10, ("2025-01-01", "2025-01-05"), ("2025-03-03", "2025-03-04")),
    ("2025-01-01", "2025-07-19", "week", 29, ("2025-01-01", "2025-01-05"), ("2025-07-14", "2025-07-19")),
    ("2025-01-01", "2025-07-20", "month", 7, ("2025-01-01", "2025-01-31"), ("2025-07-01", "2025-07-20")),
    ("2025-01-13", "2026-01-13", "month", 13, ("2025-01-13", "2025-01-31"), ("2026-01-01", "2026-01-13")),
])
def test_rentang_ember(db, r, dari, sampai, ember, n, awal, akhir):
    s = r.shift(r.a, "2024-12-31 07:00+08")
    for t in ("2025-01-01 00:10+08", "2025-01-05 23:50+08", "2025-01-06 00:10+08", "2025-03-03 21:00+08",
              "2025-07-19 23:59+08", "2025-12-31 12:00+08"):
        r.nota(r.a, s, t, 15000)
    x = rentang(db, r.pemilik, dari, sampai)
    assert x["bucket"] == ember and len(x["series"]) == n
    se = x["series"]
    assert (se[0]["label_start"], se[0]["label_end"]) == awal
    assert (se[-1]["label_start"], se[-1]["label_end"]) == akhir
    assert sum(b["omzet"] for b in se) == x["omzet"] and sum(b["notas"] for b in se) == x["notas"]
    # ember bersambung tanpa celah
    for a, b in zip(se, se[1:]):
        assert db.sql(f"select '{a['label_end']}'::date + 1 = '{b['label_start']}'::date") == [("t",)]
    if ember == "week":
        assert se[1]["label_start"] == "2025-01-06" and (se[0]["notas"], se[1]["notas"]) == (2, 1)


def test_rentang_validasi(db, r):
    for dari, sampai, pesan in (("2025-02-01", "2025-01-31", "Tanggal akhir tidak boleh sebelum tanggal awal"),
                                ("2025-01-01", "2026-01-02", "Rentang paling panjang 366 hari")):
        with pytest.raises(SqlError, match=pesan):
            rentang(db, r.pemilik, dari, sampai)
    with pytest.raises(SqlError, match="Pilih tanggal awal dan akhir"):
        db.sql("select pos_report_range(null, '2025-01-01')", sebagai=r.pemilik)
    assert rentang(db, r.pemilik, "2024-01-01", "2024-12-31")["days_count"] == 366  # kabisat: 366 hari boleh


def test_rentang_khusus_pemilik(db, r):
    q = "select pos_report_range('2025-01-01', '2025-01-31')"
    for siapa in (r.a, {**r.pemilik, "aal": "aal1"}, db.user("bukan@x.id")):
        with pytest.raises(SqlError, match="Khusus pemilik"):
            db.sql(q, sebagai=siapa)
    with pytest.raises(SqlError, match="permission denied"):
        db.sql(q, sebagai={"role": "anon"})


def test_rentang_hak_fungsi(db):
    f = "public.pos_report_range(date, date)"
    assert db.sql(f"select has_function_privilege('anon', '{f}', 'execute'), "
                  f"has_function_privilege('authenticated', '{f}', 'execute')") == [("f", "t")]
    assert db.sql("select has_function_privilege('authenticated', 'public.pos__sales(timestamptz, timestamptz)', 'execute')") \
        == [("f",)]
    assert db.sql("select count(*) from pg_proc where proname = 'pos_report_month'") == [("0",)]
