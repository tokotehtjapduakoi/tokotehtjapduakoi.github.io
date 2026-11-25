import pytest

from db import SqlError, aal2


def test_kolam_setup_jalan(db):
    assert db.sql("select count(*) from kk_cards") == [("13",)]


def test_klaim_nota_lama_masih_jalan(db):
    k = db.user("k@x.id", peran="pemilik")
    db.sql("select kk_add_receipt('POS-1',45000)", sebagai=aal2(k))
    m = db.member("6281200000001")
    assert db.sql("select kk_claim('POS-1',45000)->>'status'", sebagai=m) == [("ok",)]


def test_anon_tidak_bisa_baca_staf(db):
    with pytest.raises(SqlError, match="permission denied"):
        db.sql("select * from kk_staff", sebagai={"role": "anon"})


def test_rls_berlaku_dan_foldername(db):
    db.user("a@x.id")
    # authenticated non-staf tidak melihat baris kk_staff (RLS aktif, bukan superuser)
    k = db.user("p@x.id", peran="pemilik")
    m = db.member("6281200000002")
    assert db.sql("select count(*) from kk_staff", sebagai=m) == [("0",)]
    assert db.sql("select count(*) from kk_staff", sebagai=k) == [("1",)]
    assert db.sql("select storage.foldername('a/b/c.png')::text, storage.foldername('x')::text") == [("{a,b}", "{}")]
