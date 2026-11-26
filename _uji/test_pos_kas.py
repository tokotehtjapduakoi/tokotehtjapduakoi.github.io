"""Ambil / tambah uang laci oleh pemilik (pos_cash_move, pos_cash_status) dan dampaknya ke laporan."""
import json

import pytest

from db import SqlError
from test_pos_shift import Laci


@pytest.fixture
def laci(db):
    return Laci(db)


def gerak(db, laci, kind, jumlah, alasan="Setor ke bank", foto="baru", sebagai=None):
    if foto == "baru":
        foto = laci.foto(laci.pemilik, f"kas-{laci.n + 1}")
    arg = "null" if foto is None else f"$f${foto}$f$"
    return json.loads(db.sql(f"select pos_cash_move('{kind}', {jumlah}, $r${alasan}$r$, {arg})",
                             sebagai=sebagai or laci.pemilik)[0][0])


def ditolak(db, laci, pesan, *a, **k):
    with pytest.raises(SqlError, match=pesan):
        gerak(db, laci, *a, **k)


def laporan(db, laci):
    return json.loads(db.sql("select pos_report()", sebagai=laci.pemilik)[0][0])


def status(db, laci):
    return json.loads(db.sql("select pos_cash_status()", sebagai=laci.pemilik)[0][0])


def test_khusus_pemilik_aal2(db, laci):
    laci.buka(laci.a, 100000)
    for siapa in (laci.a, {**laci.pemilik, "aal": "aal1"}, db.member("6281200000001")):
        ditolak(db, laci, "Khusus pemilik", "tambah", 1000, foto=None, sebagai=siapa)
        with pytest.raises(SqlError, match="Khusus pemilik"):
            db.sql("select pos_cash_status()", sebagai=siapa)
    for q in ("select pos_cash_move('tambah', 1000, 'abc', null)", "select pos_cash_status()"):
        with pytest.raises(SqlError, match="permission denied"):
            db.sql(q, sebagai={"role": "anon"})
    assert db.sql("select count(*) from pos_cash_moves") == [("0",)]


def test_hitungan_dalam_shift(db, laci):
    s = laci.buka(laci.b, 100000)  # shift kasir mana pun
    laci.jual(laci.b, s["id"], 30000)
    r = gerak(db, laci, "ambil", 50000)
    assert (r["shift_id"], r["after_close"], r["expected"]) == (s["id"], False, 80000)
    r = gerak(db, laci, "tambah", 20000, alasan="Tambah uang kecil", foto=None)  # foto boleh kosong untuk tambah
    assert r["expected"] == 100000
    assert db.sql(f"select pos_shift_expected({s['id']})") == [("100000",)]
    st = status(db, laci)
    assert st["target"]["shift_id"] == s["id"] and st["target"]["open"] is True and st["target"]["expected"] == 100000
    assert [(m["kind"], m["amount"], m["by"]) for m in st["moves"]] == [("tambah", 20000, "pemilik@x.id"),
                                                                       ("ambil", 50000, "pemilik@x.id")]
    laci.tutup(laci.b, 100000, False)
    sh = laporan(db, laci)["shifts"][0]
    assert (sh["expected"], sh["selisih"], sh["ambil"], sh["tambah"]) == (100000, 0, 50000, 20000)
    assert db.sql("select action, new->>'amount', by_user = '%s' from pos_audit where tbl = 'pos_cash_moves' order by id"
                  % laci.pemilik["sub"]) == [("ambil", "50000", "t"), ("tambah", "20000", "t")]


def test_ambil_setelah_tutup_toko_tanpa_selisih_palsu(db, laci):
    s = laci.buka(laci.a, 100000)
    laci.jual(laci.a, s["id"], 50000)
    laci.tutup(laci.a, 150000, False)
    r = gerak(db, laci, "ambil", 120000)  # setor ke bank sesudah tutup
    assert (r["shift_id"], r["after_close"], r["expected"]) == (s["id"], True, 30000)
    assert status(db, laci)["target"] == {"shift_id": s["id"], "open": False, "cashier": "a@x.id",
                                          "expected": 30000, "closed_at": status(db, laci)["target"]["closed_at"]}
    # selisih shift yang sudah tutup tidak berubah
    assert db.sql(f"select pos_shift_expected({s['id']})") == [("150000",)]
    laci.buka(laci.b, 30000)  # besok: modal = 150.000 − 120.000
    sh = laporan(db, laci)["shifts"]
    assert [(x["selisih"], x["start_mismatch"]) for x in sh] == [(0, False), (None, False)]
    assert (sh[0]["ambil"], sh[0]["ambil_setelah_tutup"]) == (0, 120000)
    # tutup toko yang sudah disusul shift baru bukan lagi sasaran: sekarang shift B
    assert gerak(db, laci, "tambah", 5000, foto=None)["shift_id"] == s["id"] + 1


def test_modal_tidak_sesuai_setelah_ambil_tetap_ditandai(db, laci):
    laci.buka(laci.a, 100000)
    laci.tutup(laci.a, 100000, False)
    gerak(db, laci, "ambil", 60000)
    gerak(db, laci, "tambah", 10000, foto=None)
    laci.buka(laci.b, 100000)  # seharusnya 50.000
    assert [x["start_mismatch"] for x in laporan(db, laci)["shifts"]] == [False, True]


def test_ambil_melebihi_laci_ditolak(db, laci):
    s = laci.buka(laci.a, 100000)
    laci.jual(laci.a, s["id"], 30000)
    ditolak(db, laci, r"melebihi uang di laci \(seharusnya 130\.000\)", "ambil", 130001)
    assert gerak(db, laci, "ambil", 130000)["expected"] == 0
    ditolak(db, laci, r"seharusnya 0\)", "ambil", 1)
    laci.tutup(laci.a, 0, False)
    gerak(db, laci, "tambah", 5000, foto=None)
    ditolak(db, laci, r"seharusnya 5\.000\)", "ambil", 6000)


def test_foto_dan_isian(db, laci):
    laci.buka(laci.a, 100000)
    for foto in (None, "", "  "):
        ditolak(db, laci, "Foto bukti wajib untuk ambil kas", "ambil", 1000, foto=foto)
    ditolak(db, laci, "Foto bukti tidak ditemukan", "ambil", 1000, foto=f"{laci.pemilik['sub']}/kas-belum.jpg")
    ditolak(db, laci, "Foto bukti tidak ditemukan", "ambil", 1000, foto=laci.foto(laci.a))  # folder kasir lain
    f = laci.foto(laci.pemilik, "kas-satu")
    gerak(db, laci, "ambil", 1000, foto=f)
    ditolak(db, laci, "Foto bukti sudah dipakai", "ambil", 1000, foto=f)
    ditolak(db, laci, "Foto bukti sudah dipakai", "tambah", 1000, foto=f)
    # foto kas juga tidak bisa dipakai sebagai foto tutup shift / nota
    laci.tutup(laci.a, 99000, True)
    laci.terima(laci.pemilik, 99000)
    with pytest.raises(SqlError, match="Foto bukti sudah dipakai"):
        db.sql(f"select pos_shift_close(99000, '{f}', false)", sebagai=laci.pemilik)
    ditolak(db, laci, "Tulis alasan", "tambah", 1000, alasan=" ab ", foto=None)
    ditolak(db, laci, "Alasan terlalu panjang", "tambah", 1000, alasan="x" * 201, foto=None)
    for n in (0, -5, "null"):
        ditolak(db, laci, "Jumlah uang tidak valid", "tambah", n, foto=None)
    ditolak(db, laci, "Pilih ambil atau tambah", "setor", 1000, foto=None)
    assert db.sql("select count(*) from pos_cash_moves") == [("1",)]
    # basis data juga menjaga
    with pytest.raises(SqlError, match="pos_cash_moves_foto_ambil"):
        db.sql("insert into pos_cash_moves(shift_id, kind, amount, reason) values (1, 'ambil', 1, 'abc')")


def test_tidak_ada_laci(db, laci):
    ditolak(db, laci, "Tidak ada laci yang bisa dicatat", "tambah", 1000, foto=None)
    assert status(db, laci)["target"] is None
    laci.buka(laci.a, 0)
    laci.tutup(laci.a, 0, True)  # serah terima menunggu diterima
    ditolak(db, laci, "Tidak ada laci yang bisa dicatat", "tambah", 1000, foto=None)
    st = status(db, laci)
    assert st["target"] is None and st["handover_waiting"] is True


def test_kasir_hanya_tahu_ada_gerak_kas(db, laci):
    laci.buka(laci.a, 100000)
    me = lambda: json.loads(db.sql("select pos_me('dev1')", sebagai=laci.a)[0][0])  # noqa: E731
    assert me()["cash_moves_today"] is False
    gerak(db, laci, "ambil", 40000)
    m = me()
    assert m["cash_moves_today"] is True
    assert "40000" not in json.dumps(m) and "expected" not in json.dumps(m)
    with pytest.raises(SqlError, match="permission denied"):
        db.sql("select * from pos_cash_moves", sebagai=laci.a)


def test_laporan_harian_dan_rentang(db, laci):
    laci.buka(laci.a, 500000)
    gerak(db, laci, "ambil", 100000)
    gerak(db, laci, "tambah", 25000, alasan="Tambah uang kecil", foto=None)
    c = laporan(db, laci)["cash"]
    assert (c["ambil_total"], c["tambah_total"], c["count"]) == (100000, 25000, 2)
    assert [(m["kind"], m["amount"], m["reason"], m["by"]) for m in c["moves"]] == [
        ("tambah", 25000, "Tambah uang kecil", "pemilik@x.id"), ("ambil", 100000, "Setor ke bank", "pemilik@x.id")]
    assert all(m["at"] for m in c["moves"])
    # 55 gerak lagi: rentang hanya menampilkan 50 terbaru, total tetap semua
    db.sql("insert into pos_cash_moves(shift_id, kind, amount, reason, by_user, at) "
           f"select 1, 'tambah', 1000, 'isi ' || g, '{laci.pemilik['sub']}', now() + g * interval '1 second' "
           "from generate_series(1, 55) g")
    hari = db.sql("select (now() at time zone 'Asia/Makassar')::date")[0][0]
    rg = json.loads(db.sql(f"select pos_report_range('{hari}', '{hari}')", sebagai=laci.pemilik)[0][0])["cash"]
    assert (rg["ambil_total"], rg["tambah_total"], rg["moves_count"]) == (100000, 80000, 57)
    assert len(rg["moves"]) == 50 and rg["moves"][0]["reason"] == "isi 55"
    assert {"shifts", "total_selisih", "shifts_with_selisih"} <= rg.keys()
    kosong = json.loads(db.sql("select pos_report_range('2020-01-01', '2020-01-31')", sebagai=laci.pemilik)[0][0])["cash"]
    assert (kosong["ambil_total"], kosong["tambah_total"], kosong["moves_count"], kosong["moves"]) == (0, 0, 0, [])


def test_hak_tabel_dan_fungsi(db):
    assert db.sql("select relrowsecurity from pg_class where oid = 'public.pos_cash_moves'::regclass") == [("t",)]
    for peran in ("anon", "authenticated"):
        for hak in ("select", "insert", "update", "delete"):
            assert db.sql(f"select has_table_privilege('{peran}', 'public.pos_cash_moves', '{hak}')") == [("f",)]
        assert db.sql(f"select has_sequence_privilege('{peran}', 'public.pos_cash_moves_id_seq', 'usage')") == [("f",)]
    assert db.sql("select has_table_privilege('service_role', 'public.pos_cash_moves', 'insert')") == [("t",)]
    for f, anon, auth in (("public.pos_cash_move(text, int, text, text)", "f", "t"), ("public.pos_cash_status()", "f", "t"),
                          ("public.pos__cash_after(bigint)", "f", "f"), ("public.pos__cash_target()", "f", "f"),
                          ("public.pos__cash_moves(timestamptz, timestamptz, int)", "f", "f")):
        assert db.sql(f"select has_function_privilege('anon', '{f}', 'execute'), "
                      f"has_function_privilege('authenticated', '{f}', 'execute')") == [(anon, auth)], f
