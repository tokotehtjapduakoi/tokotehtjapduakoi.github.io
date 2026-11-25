import pytest

from db import SqlError, aal2

KODE = "ABCDE23456"


def siapkan(db, *, total=45000, kolom="", nilai="", kasir_phone=None):
    """Nota berkode disisipkan langsung (superuser), seperti yang nanti dibuat pos_checkout."""
    kasir = db.user("kasir@x.id", peran="kasir")
    if kasir_phone:
        db.sql(f"update kk_staff set phone = '{kasir_phone}' where user_id = '{kasir['sub']}'")
    ekstra_k = f", {kolom}" if kolom else ""
    ekstra_n = f", {nilai}" if nilai else ""
    db.sql(
        "insert into kk_receipts(nota, total, created_by, code_hash, expires_at" + ekstra_k + ") values ("
        f"'POS-1', {total}, '{kasir['sub']}', encode(extensions.digest('{KODE}','sha256'),'hex'), "
        "now() + interval '2 hours'" + ekstra_n + ")")
    return kasir


def klaim(db, member, kode="ABCDE-23456"):
    return db.sql(f"select kk_claim_code($k${kode}$k$)", sebagai=member)[0][0]


def status(db, member, kode="ABCDE-23456"):
    return db.sql(f"select kk_claim_code($k${kode}$k$)->>'status'", sebagai=member)[0][0]


def test_klaim_kode_ok(db):
    siapkan(db)
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'status'", sebagai=m) == [("ok",)]
    assert db.sql("select claimed_by is not null from kk_receipts where nota='POS-1'") == [("t",)]


def test_klaim_kode_pulls(db):
    siapkan(db)
    m = db.member("6281200000001")
    assert db.sql("select (kk_claim_code('ABCDE-23456')->>'pulls')::int", sebagai=m) == [("2",)]
    assert db.sql("select count(*) from kk_pulls") == [("2",)]


def test_klaim_kode_dinormalisasi(db):
    siapkan(db)
    m = db.member("6281200000001")
    assert status(db, m, " abcde 23456 ") == "ok"


def test_klaim_kode_sekali(db):
    siapkan(db)
    a, b = db.member("6281200000001"), db.member("6281200000002")
    assert status(db, a) == "ok"
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'status', kk_claim_code('ABCDE-23456')->>'mine'", sebagai=b) \
        == [("used", "false")]
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'mine'", sebagai=a) == [("true",)]
    assert db.sql("select fails from kk_members where phone='6281200000002'") == [("0",)]


def test_kode_kedaluwarsa(db):
    siapkan(db)
    db.sql("update kk_receipts set expires_at = now() - interval '1 minute'")
    m = db.member("6281200000001")
    assert status(db, m) == "expired"
    assert db.sql("select fails from kk_members") == [("0",)]


def test_kode_terikat_nomor(db):
    siapkan(db, kolom="bound_phone", nilai="'6281200000009'")
    salah, benar = db.member("6281200000001"), db.member("6281200000009")
    assert status(db, salah) == "wrong_phone"
    assert db.sql("select fails from kk_members where phone='6281200000001'") == [("1",)]
    assert status(db, benar) == "ok"


def test_kode_staf_sendiri(db):
    siapkan(db, kasir_phone="6281200000005")
    m = db.member("6281200000005")
    assert status(db, m) == "staff_own"
    assert db.sql("select fails from kk_members") == [("0",)]
    assert db.sql("select claimed_by is null from kk_receipts where nota='POS-1'") == [("t",)]


def test_kode_void_dan_held(db):
    siapkan(db)
    m = db.member("6281200000001")
    db.sql("update kk_receipts set voided_at = now()")
    assert status(db, m) == "void"
    db.sql("update kk_receipts set voided_at = null, held = true")
    assert status(db, m) == "pending"
    assert db.sql("select fails from kk_members") == [("0",)]


def test_kode_salah_hitung_left(db):
    siapkan(db)
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ZZZZZ-ZZZZ2')->>'status', kk_claim_code('OOOOO-00000')->>'left'", sebagai=m) \
        == [("not_found", "8")]


def test_salah_10x_terkunci(db):
    siapkan(db)
    m = db.member("6281200000001")
    for i in range(10):
        assert status(db, m, f"ZZZZZ-ZZZZ{i % 8 + 2}") == "not_found"
    assert status(db, m, "ZZZZZ-ZZZZ9") == "blocked"
    assert status(db, m) == "blocked"  # kode benar pun ditolak saat terkunci


def test_nota_manual_khusus_pemilik_mfa(db):
    kasir = db.user("k@x.id", peran="kasir")
    pemilik = db.user("p@x.id", peran="pemilik")
    with pytest.raises(SqlError, match="Khusus pemilik"):
        db.sql("select kk_add_receipt('M-1',30000)", sebagai=aal2(kasir))
    with pytest.raises(SqlError, match="Khusus pemilik"):
        db.sql("select kk_add_receipt('M-1',30000)", sebagai=pemilik)
    with pytest.raises(SqlError, match="Khusus pemilik"):
        db.sql("select kk_add_receipts('[{\"nota\":\"M-2\",\"total\":30000}]'::jsonb)", sebagai=pemilik)
    with pytest.raises(SqlError, match="Khusus pemilik"):
        db.sql("select kk_reset_pin('6281200000001','123456')", sebagai=pemilik)
    db.sql("select kk_add_receipt('M-1',30000)", sebagai=aal2(pemilik))
    assert db.sql("select count(*) from kk_receipts where nota='M-1'") == [("1",)]
    with pytest.raises(SqlError, match="Khusus pemilik"):
        db.sql("select kk_delete_receipt('M-1')", sebagai=pemilik)
    db.sql("select kk_delete_receipt('M-1')", sebagai=aal2(pemilik))


def test_set_staff_perlu_mfa_dan_telepon(db):
    pemilik = db.user("p@x.id", peran="pemilik")
    db.user("baru@x.id")
    with pytest.raises(SqlError, match="Khusus pemilik"):
        db.sql("select kk_set_staff('baru@x.id','kasir','Budi')", sebagai=pemilik)
    # tiga argumen (cara lama admin.js) tetap jalan
    db.sql("select kk_set_staff('baru@x.id','kasir','Budi')", sebagai=aal2(pemilik))
    assert db.sql("select phone from kk_staff where name='Budi'") == [(None,)]
    db.sql("select kk_set_staff('baru@x.id','kasir','Budi','6281200000005')", sebagai=aal2(pemilik))
    assert db.sql("select phone from kk_staff where name='Budi'") == [("6281200000005",)]
    db.sql("select kk_set_staff('baru@x.id','kasir','Budi')", sebagai=aal2(pemilik))  # nomor tidak terhapus
    assert db.sql("select phone from kk_staff where name='Budi'") == [("6281200000005",)]
    with pytest.raises(SqlError, match="Nomor"):
        db.sql("select kk_set_staff('baru@x.id','kasir','Budi','0812')", sebagai=aal2(pemilik))


def test_admin_summary_mfa(db):
    pemilik = db.user("p@x.id", peran="pemilik")
    assert db.sql("select kk_admin_summary()->>'mfa'", sebagai=pemilik) == [("false",)]
    assert db.sql("select kk_admin_summary()->>'mfa'", sebagai=aal2(pemilik)) == [("true",)]


def test_klaim_lama_bisa_dimatikan(db):
    pemilik = db.user("p@x.id", peran="pemilik")
    db.sql("insert into kk_receipts(nota,total) values ('POS-1',45000)")
    m = db.member("6281200000001")
    with pytest.raises(SqlError, match="Khusus pemilik"):
        db.sql("select kk_set_legacy_claim(false)", sebagai=pemilik)
    db.sql("select kk_set_legacy_claim(false)", sebagai=aal2(pemilik))
    assert db.sql("select kk_claim('POS-1',45000)->>'status'", sebagai=m) == [("not_found",)]
    assert db.sql("select fails from kk_members") == [("0",)]
    db.sql("select kk_set_legacy_claim(true)", sebagai=aal2(pemilik))
    assert db.sql("select kk_claim('POS-1',45000)->>'status'", sebagai=m) == [("ok",)]


def test_klaim_lama_tidak_bisa_pakai_nota_berkode(db):
    siapkan(db)
    m = db.member("6281200000001")
    assert db.sql("select kk_claim('POS-1',45000)->>'status'", sebagai=m) == [("not_found",)]
    assert db.sql("select claimed_by is null from kk_receipts where nota='POS-1'") == [("t",)]
    assert db.sql("select fails from kk_members") == [("0",)]


def test_klaim_lama_tolak_void_dan_held(db):
    db.sql("insert into kk_receipts(nota,total,voided_at) values ('V-1',45000,now())")
    db.sql("insert into kk_receipts(nota,total,held) values ('H-1',45000,true)")
    m = db.member("6281200000001")
    assert db.sql("select kk_claim('V-1',45000)->>'status'", sebagai=m) == [("not_found",)]
    assert db.sql("select kk_claim('H-1',45000)->>'status'", sebagai=m) == [("not_found",)]


def test_kk_draw_tidak_bisa_dipanggil_klien(db):
    m = db.member("6281200000001")
    for peran in (m, {"role": "anon"}):
        with pytest.raises(SqlError, match="permission denied"):
            db.sql(f"select kk__draw('{m['sub']}', 'POS-1')", sebagai=peran)
    with pytest.raises(SqlError, match="permission denied"):
        db.sql("select kk_set_staff('a@x.id','kasir','x')", sebagai={"role": "anon"})


def test_kode_too_small(db):
    siapkan(db, total=10000)
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'status'", sebagai=m) == [("too_small",)]
    assert db.sql("select count(*) from kk_pulls") == [("0",)]


def test_setup_bisa_dijalankan_ulang(db):
    from db import AKAR
    db.sql((AKAR / "kolam" / "setup.sql").read_text())
    assert db.sql("select count(*) from pg_proc where proname='kk_set_staff'") == [("1",)]
    assert db.sql("select count(*) from kk_settings") == [("1",)]
