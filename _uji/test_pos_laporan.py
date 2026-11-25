import json

import pytest

from db import SqlError, aal2
from test_pos_checkout import Toko, kode_hash
from test_pos_shift import Laci
from test_pos_void import ajukan, nota_tiga, putuskan


@pytest.fixture
def toko(db):
    return Toko(db)


@pytest.fixture
def laci(db):
    return Laci(db)


def laporan(db, siapa, hari=None):
    arg = f"'{hari}'::date" if hari else ""
    return json.loads(db.sql(f"select pos_report({arg})", sebagai=siapa)[0][0])


def varian(db, toko, nama, harga):
    item = db.sql(f"select pos_item_save('{{\"name\":\"{nama}\"}}')", sebagai=toko.pemilik)[0][0]
    return int(db.sql(f"select pos_variant_save('{{\"item_id\":{item},\"name\":\"std\",\"price\":{harga}}}')",
                      sebagai=toko.pemilik)[0][0])


def jual_tiga(db, toko):
    """Kasir A: tunai 30.000 + tunai 15.000; kasir B: QRIS 22.000. Mengembalikan (nota15, lain)."""
    vid22 = varian(db, toko, "Es Teh", 22000)
    toko.checkout(toko.payload(code="AAAAA22222"))
    n15 = toko.checkout(toko.payload(code="AAAAA33333", lines=[{"variant_id": toko.vid, "qty": 1}], total=15000))
    lain = db.user("lain@x.id", peran="kasir")
    toko.buka_shift(lain)
    toko.checkout(toko.payload(kasir=lain, code="AAAAA44444", lines=[{"variant_id": vid22, "qty": 1}], total=22000,
                               method_id=toko.qris, cash_received=None), kasir=lain)
    return n15, lain


def test_laporan_angka(db, toko):
    n15, lain = jual_tiga(db, toko)
    req = ajukan(db, toko, n15["id"], alasan="pelanggan batal beli")
    putuskan(db, toko, req, True)
    r = laporan(db, toko.pemilik)
    assert r["omzet"] == 52000 and r["notas"] == 2 and r["avg"] == 26000
    assert r["by_method"] == [{"name": "Tunai", "total": 30000, "count": 1},
                              {"name": "QRIS", "total": 22000, "count": 1}]
    assert r["by_cashier"] == [{"name": "kasir@x.id", "total": 30000, "count": 1},
                               {"name": "lain@x.id", "total": 22000, "count": 1}]
    assert [(t["item"], t["qty"], t["total"]) for t in r["top_items"]] == [("Teh Tarik", 2, 30000), ("Es Teh", 1, 22000)]
    assert r["voids"] == [{"no": n15["no"], "total": 15000, "reason": "pelanggan batal beli",
                           "by": "kasir@x.id", "approved_by": "pemilik@x.id"}]
    assert r["pending_voids"] == 0 and r["discounts"] == {"count": 0, "total": 0}
    assert r["offline"] == {"count": 0, "mismatch": [], "held": 0}
    assert r["codes"] == {"issued": 2, "claimed": 0, "expired_unclaimed": 0}
    assert r["suspicious"] == [] and r["storage_mb"] is None
    assert laporan(db, toko.pemilik, "2000-01-01")["omzet"] == 0


def test_laporan_pengajuan_tertunda_dihitung(db, toko):
    n = nota_tiga(toko)
    ajukan(db, toko, n["id"])
    assert laporan(db, toko.pemilik)["pending_voids"] == 1


def test_laporan_khusus_pemilik(db, toko):
    for siapa in (toko.kasir, db.user("anon@x.id")):
        with pytest.raises(SqlError, match="Khusus pemilik"):
            db.sql("select pos_report()", sebagai=siapa)
    # aal1 pemilik cukup untuk membaca
    assert laporan(db, {**toko.pemilik, "aal": "aal1"})["notas"] == 0
    with pytest.raises(SqlError):
        db.sql("select pos_report()", sebagai={"role": "anon"})


def test_laporan_batas_hari_wita(db, toko):
    ts = db.sql("select (date_trunc('day', now() at time zone 'Asia/Makassar') - interval '30 minutes') "
                "at time zone 'Asia/Makassar'")[0][0]  # kemarin pukul 23.30 WITA
    toko.checkout(toko.payload(offline=True, client_at=ts))
    kemarin = db.sql("select ((now() at time zone 'Asia/Makassar')::date - 1)::text")[0][0]
    assert laporan(db, toko.pemilik, kemarin)["omzet"] == 30000
    assert laporan(db, toko.pemilik)["omzet"] == 0
    assert laporan(db, toko.pemilik, kemarin)["offline"]["count"] == 1


def test_laporan_offline_selisih_tahan_dan_diskon(db, toko):
    toko.checkout(toko.payload(code="AAAAA22222"))
    db.sql("update pos_price_history set valid_from = now() - interval '1 hour'")
    db.sql(f"select pos_variant_save('{{\"id\":{toko.vid},\"price\":16000}}')", sebagai=toko.pemilik)
    ts = db.sql("select now() - interval '30 minutes'")[0][0]
    toko.checkout(toko.payload(code="AAAAA33333", offline=True, client_at=ts, total=28000, cash_received=30000,
                               lines=[{"variant_id": toko.vid, "qty": 2}]))
    r = laporan(db, toko.pemilik)
    assert r["offline"]["count"] == 1
    assert r["offline"]["mismatch"] == [{"no": r["offline"]["mismatch"][0]["no"], "total": 28000, "server_total": 30000}]
    db.sql("update pos_notas set held = true where price_mismatch")
    assert laporan(db, toko.pemilik)["offline"]["held"] == 1
    db.sql("alter table pos_notas disable trigger user")
    db.sql("update pos_notas set discount_amt = 2500 where not price_mismatch")
    assert laporan(db, toko.pemilik)["discounts"] == {"count": 1, "total": 2500}


def test_laporan_kode_dan_mencurigakan(db, toko):
    nota = [toko.checkout(toko.payload(code=f"AAAAA2222{i}")) for i in "234"]
    toko.checkout(toko.payload(code="AAAAA55555"))
    db.sql(f"update kk_receipts set expires_at = now() - interval '1 minute' where code_hash = '{kode_hash('AAAAA55555')}'")
    m = db.member("6281200000001")
    for i in "234":
        assert db.sql(f"select kk_claim_code('AAAAA-2222{i}')->>'status'", sebagai=m) == [("ok",)]
    r = laporan(db, toko.pemilik)
    assert r["codes"] == {"issued": 4, "claimed": 3, "expired_unclaimed": 1}
    assert [s["no"] for s in r["suspicious"]] == [nota[2]["no"]]  # klaim ketiga, di bawah 60 detik
    # klaim lambat tidak dicurigai
    db.sql("update kk_receipts set claimed_at = claimed_at + interval '5 minutes'")
    assert laporan(db, toko.pemilik)["suspicious"] == []


def test_laporan_ukuran_bukti(db, toko):
    toko.checkout(toko.payload())
    toko.checkout(toko.payload(code="AAAAA22222"))
    db.sql("update storage.objects set metadata = '{\"size\": 1572864}'::jsonb where bucket_id = 'bukti'")
    assert laporan(db, toko.pemilik)["storage_mb"] == 3.0
    db.sql("update storage.objects set bucket_id = 'lain'")
    assert laporan(db, toko.pemilik)["storage_mb"] is None


def test_laporan_shift_selisih_dan_modal_awal(db, laci):
    a1 = laci.buka(laci.a, 100000)
    laci.jual(laci.a, a1["id"], 30000)
    laci.tutup(laci.a, 125000, True)  # seharusnya 130.000
    laci.terima(laci.b, 120000)  # terima: kurang 5.000 dari hitungan A
    b = db.sql("select id from pos_shifts where received_from is not null")[0][0]
    laci.tutup(laci.b, 120000, False)  # tutup toko
    laci.buka(laci.a, 100000)  # buka baru, padahal laci terakhir 120.000
    s = laporan(db, laci.pemilik)["shifts"]
    assert [x["cashier"] for x in s] == ["a@x.id", "b@x.id", "a@x.id"]
    assert [(x["cash_start"], x["expected"], x["counted"], x["selisih"]) for x in s] == [
        (100000, 130000, 125000, -5000), (120000, 120000, 120000, 0), (100000, 100000, None, None)]
    assert [x["received_count"] for x in s] == [120000, None, None]
    assert [x["selisih_terima"] for x in s] == [-5000, None, None]
    assert [x["start_mismatch"] for x in s] == [False, False, True]
    assert s[2]["closed_at"] is None and b


def test_laporan_modal_awal_cocok(db, laci):
    laci.buka(laci.a, 50000)
    laci.tutup(laci.a, 70000, False)
    laci.buka(laci.b, 70000)
    assert [x["start_mismatch"] for x in laporan(db, laci.pemilik)["shifts"]] == [False, False]


def test_kas_diharapkan_turun_setelah_void(db, toko):
    n = toko.checkout(toko.payload())
    shift = db.sql("select id from pos_shifts")[0][0]
    assert db.sql(f"select pos_shift_expected({shift})") == [("30000",)]
    putuskan(db, toko, ajukan(db, toko, n["id"]), True)
    assert db.sql(f"select pos_shift_expected({shift})") == [("0",)]


def test_void_menurunkan_hitungan_member(db, toko):
    n = nota_tiga(toko)
    m = db.member("6281200000001")
    db.sql("select kk_claim_code('ABCDE-23456')", sebagai=m)
    assert db.sql("select trx, spent from kk_members") == [("1", "45000")]
    putuskan(db, toko, ajukan(db, toko, n["id"]), True)
    assert db.sql("select trx, spent from kk_members") == [("0", "0")]


def test_void_hitungan_member_tidak_di_bawah_nol(db, toko):
    n = nota_tiga(toko)
    m = db.member("6281200000001")
    db.sql("select kk_claim_code('ABCDE-23456')", sebagai=m)
    db.sql("update kk_members set trx = 0, spent = 10000")
    putuskan(db, toko, ajukan(db, toko, n["id"]), True)
    assert db.sql("select trx, spent from kk_members") == [("0", "0")]


def test_void_belum_diklaim_tidak_menyentuh_member(db, toko):
    n = nota_tiga(toko)
    m = db.member("6281200000001")
    db.sql("update kk_members set trx = 4, spent = 100000")
    putuskan(db, toko, ajukan(db, toko, n["id"]), True)
    assert db.sql("select trx, spent from kk_members") == [("4", "100000")]
    assert m
