import json

import pytest

from db import SqlError, aal2
from test_pos_checkout import Toko, voucher


@pytest.fixture
def toko(db):
    return Toko(db)


def nota_tiga(toko, **ubah):
    """Nota 3 x 15.000 = 45.000 -> 2 tarikan."""
    p = toko.payload(lines=[{"variant_id": toko.vid, "qty": 3}], total=45000, cash_received=50000, **ubah)
    return toko.checkout(p)


def ajukan(db, toko, nota_id, alasan="salah input harga", kasir=None):
    return int(db.sql(f"select pos_void_request('{nota_id}', $a${alasan}$a$)", sebagai=kasir or toko.kasir)[0][0])


def putuskan(db, toko, req, setuju):
    return json.loads(db.sql(f"select pos_void_decide({req}, {str(setuju).lower()})", sebagai=toko.pemilik)[0][0])


def test_kasir_tidak_bisa_setujui_void(db, toko):
    n = nota_tiga(toko)
    req = ajukan(db, toko, n["id"])
    for siapa in (toko.kasir, {**toko.pemilik, "aal": "aal1"}):
        with pytest.raises(SqlError, match="Khusus pemilik"):
            db.sql(f"select pos_void_decide({req}, true)", sebagai=siapa)
        with pytest.raises(SqlError, match="Khusus pemilik"):
            db.sql("select pos_void_pending()", sebagai=siapa)
    assert db.sql(f"select status from pos_notas where id='{n['id']}'") == [("lunas",)]


def test_alasan_pendek_ditolak(db, toko):
    n = nota_tiga(toko)
    with pytest.raises(SqlError, match="Alasan"):
        ajukan(db, toko, n["id"], alasan=" abc ")


def test_void_disetujui_mematikan_kode(db, toko):
    n = nota_tiga(toko)
    req = ajukan(db, toko, n["id"])
    assert db.sql("select has_void_request from (select (jsonb_array_elements(pos_my_notas())->>'has_void_request') "
                  "as has_void_request) x", sebagai=toko.kasir) == [("true",)]
    pend = json.loads(db.sql("select pos_void_pending()", sebagai=toko.pemilik)[0][0])
    assert len(pend) == 1 and pend[0]["no"] == n["no"] and pend[0]["reason"] == "salah input harga" \
        and pend[0]["claimed"] is False and pend[0]["cashier"] == "kasir@x.id"
    assert putuskan(db, toko, req, True) == {"approved": True, "cards_missing": []}
    assert db.sql(f"select status, voided_at is not null from pos_notas where id='{n['id']}'") == [("batal", "t")]
    assert db.sql("select voided_at is not null from kk_receipts") == [("t",)]
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'status'", sebagai=m) == [("void",)]
    assert db.sql("select pos_void_pending()", sebagai=toko.pemilik) == [("[]",)]
    assert db.sql("select count(*) from pos_audit where action in ('ajukan_void','void')") == [("2",)]
    with pytest.raises(SqlError, match="sudah diputuskan"):
        putuskan(db, toko, req, True)


def test_void_setelah_klaim_tarik_kartu(db, toko):
    n = nota_tiga(toko)
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'pulls'", sebagai=m) == [("2",)]
    # kartu undian dibuat pasti beda supaya hitungan tidak ambigu
    a, b = [r[0] for r in db.sql("select id from kk_cards where not secret order by id limit 2")]
    db.sql(f"update kk_pulls set card_id = case when id = (select min(id) from kk_pulls) then '{a}' else '{b}' end")
    db.sql(f"delete from kk_inventory; insert into kk_inventory(member_id, card_id, qty) "
           f"values ('{m['sub']}', '{a}', 1), ('{m['sub']}', '{b}', 1)")
    req = ajukan(db, toko, n["id"])
    pend = json.loads(db.sql("select pos_void_pending()", sebagai=toko.pemilik)[0][0])
    assert pend[0]["claimed"] is True and pend[0]["pulls"] == 2
    assert putuskan(db, toko, req, True)["cards_missing"] == []
    assert db.sql("select coalesce(sum(qty),0) from kk_inventory") == [("0",)]


def test_void_kartu_sudah_ditukar_dicatat(db, toko):
    n = nota_tiga(toko)
    m = db.member("6281200000001")
    db.sql("select kk_claim_code('ABCDE-23456')", sebagai=m)
    a, b = [r[0] for r in db.sql("select id from kk_cards where not secret order by id limit 2")]
    db.sql(f"update kk_pulls set card_id = case when id = (select min(id) from kk_pulls) then '{a}' else '{b}' end")
    db.sql(f"delete from kk_inventory; insert into kk_inventory(member_id, card_id, qty) "
           f"values ('{m['sub']}', '{a}', 1), ('{m['sub']}', '{b}', 0)")  # kartu b sudah ditukar
    req = ajukan(db, toko, n["id"])
    r = putuskan(db, toko, req, True)
    assert r == {"approved": True, "cards_missing": [b]}
    assert db.sql(f"select qty from kk_inventory where card_id='{a}'") == [("0",)]
    assert db.sql(f"select cards_note from pos_void_requests where id={req}")[0][0].endswith(b)


def test_void_total_nol_tanpa_kode(db, toko):
    v = voucher(db)
    n = toko.checkout(toko.payload(voucher_code=v, lines=[{"variant_id": toko.vid, "qty": 1}], total=0,
                                   cash_received=0, code=None))
    assert db.sql("select count(*) from kk_receipts") == [("0",)]
    req = ajukan(db, toko, n["id"])
    assert putuskan(db, toko, req, True)["approved"] is True
    assert db.sql(f"select status from pos_notas where id='{n['id']}'") == [("batal",)]


def test_void_ditolak_nota_tetap(db, toko):
    n = nota_tiga(toko)
    req = ajukan(db, toko, n["id"])
    assert putuskan(db, toko, req, False)["approved"] is False
    assert db.sql(f"select status from pos_notas where id='{n['id']}'") == [("lunas",)]
    assert db.sql("select voided_at is null from kk_receipts") == [("t",)]
    assert json.loads(db.sql("select pos_my_notas()", sebagai=toko.kasir)[0][0])[0]["has_void_request"] is False
    ajukan(db, toko, n["id"], alasan="coba lagi ya")  # boleh diajukan lagi


def test_void_ganda_ditolak(db, toko):
    n = nota_tiga(toko)
    ajukan(db, toko, n["id"])
    with pytest.raises(SqlError, match="Sudah ada pengajuan"):
        ajukan(db, toko, n["id"], alasan="alasan lain lagi")
    # dijaga juga di tingkat tabel
    with pytest.raises(SqlError, match="pos_void_satu_terbuka"):
        db.sql(f"insert into pos_void_requests(nota_id, reason) values ('{n['id']}', 'langsung')")


def test_kasir_lain_tidak_bisa_ajukan(db, toko):
    n = nota_tiga(toko)
    lain = db.user("lain@x.id", peran="kasir")
    with pytest.raises(SqlError, match="Bukan nota kamu"):
        ajukan(db, toko, n["id"], kasir=lain)
    ajukan(db, toko, n["id"], kasir=toko.pemilik)  # pemilik boleh
    anon = db.user("bukan-staf@x.id")
    with pytest.raises(SqlError, match="Khusus kasir"):
        ajukan(db, toko, n["id"], kasir=anon)


def test_nota_batal_tidak_bisa_diajukan_lagi(db, toko):
    n = nota_tiga(toko)
    putuskan(db, toko, ajukan(db, toko, n["id"]), True)
    with pytest.raises(SqlError, match="sudah batal"):
        ajukan(db, toko, n["id"])


def test_tabel_void_terkunci_dari_klien(db, toko):
    for q in ("select * from pos_void_requests", "insert into pos_void_requests(nota_id, reason) values (gen_random_uuid(), 'x')"):
        with pytest.raises(SqlError):
            db.sql(q, sebagai=toko.pemilik)


def test_setup_aman_dijalankan_ulang(db, toko):
    import pathlib
    n = nota_tiga(toko)
    req = ajukan(db, toko, n["id"])
    db.sql((pathlib.Path(__file__).resolve().parent.parent / "kasir" / "setup.sql").read_text())
    assert putuskan(db, toko, req, True)["approved"] is True
