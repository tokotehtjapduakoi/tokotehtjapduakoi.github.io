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
    db.user("p@x.id", peran="pemilik")
    anon = {"role": "anon"}
    try:
        baris = db.sql("select * from kk_staff", sebagai=anon)
    except SqlError as e:
        assert "permission denied" in str(e)
    else:
        assert baris == []  # hak tabel longgar, tapi RLS tidak menampakkan baris


def test_null_dan_baris_baru(db):
    assert db.sql("select null, 'a'||chr(10)||'b'") == [(None, "a\nb")]
    assert db.sql("select 1 where false") == []


def test_role_tidak_didukung(db):
    with pytest.raises(ValueError):
        db.sql("select 1", sebagai={"role": "service_role"})


def test_rls_berlaku_dan_foldername(db):
    db.user("a@x.id")
    # authenticated non-staf tidak melihat baris kk_staff (RLS aktif, bukan superuser)
    k = db.user("p@x.id", peran="pemilik")
    m = db.member("6281200000002")
    assert db.sql("select count(*) from kk_staff", sebagai=m) == [("0",)]
    assert db.sql("select count(*) from kk_staff", sebagai=k) == [("1",)]
    assert db.sql("select storage.foldername('a/b/c.png')::text, storage.foldername('x')::text") == [("{a,b}", "{}")]
