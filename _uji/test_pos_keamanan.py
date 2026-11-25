"""Pengerasan: hak fungsi/sequence, kolom kk_receipts, setup aman dijalankan ulang."""
import pytest

from db import AKAR, Db, SqlError, aal2

INTERNAL = ["pos__audit", "pos__device_status", "pos_device_ok", "pos__nota_out", "pos__nota_lock",
            "pos__nota_lines_lock", "kk__use_voucher", "kk__draw"]


def jalankan(db, berkas):
    Db._psql(db.nama, (AKAR / berkas).read_text())


@pytest.mark.parametrize("f", INTERNAL)
def test_fungsi_internal_tidak_bisa_dipanggil(db, f):
    for peran in ("anon", "authenticated"):
        hasil = db.sql(f"select bool_or(has_function_privilege('{peran}', p.oid, 'execute')) from pg_proc p "
                       f"where p.pronamespace = 'public'::regnamespace and p.proname = '{f}'")
        assert hasil == [("f",)], (f, peran)


def test_anon_tidak_bisa_katalog_atau_checkout(db):
    for q in ("select pos_catalog()", "select pos_checkout('{}'::jsonb)", "select pos_my_notas()"):
        with pytest.raises(SqlError, match="permission denied"):
            db.sql(q, sebagai={"role": "anon"})


def test_sequence_pos_tertutup(db):
    seq = db.sql("select c.oid::regclass::text from pg_class c where c.relnamespace = 'public'::regnamespace "
                 "and c.relkind = 'S' and c.relname like 'pos\\_%'")
    assert len(seq) >= 6
    for (s,) in seq:
        for peran in ("anon", "authenticated"):
            for hak in ("usage", "select", "update"):
                assert db.sql(f"select has_sequence_privilege('{peran}', '{s}', '{hak}')") == [("f",)], (s, peran, hak)


def test_kode_hash_tidak_terbaca_staf(db):
    kasir = db.user("kasir@x.id", peran="kasir")
    db.sql("insert into kk_receipts(nota, total, code_hash) values ('N-1', 30000, 'abc')")
    with pytest.raises(SqlError, match="permission denied"):
        db.sql("select code_hash from kk_receipts", sebagai=kasir)
    with pytest.raises(SqlError, match="permission denied"):
        db.sql("select * from kk_receipts", sebagai=kasir)
    # kolom yang dibaca admin.js tetap bisa
    assert db.sql("select nota, total, created_at is not null, claimed_at from kk_receipts", sebagai=kasir) \
        == [("N-1", "30000", "t", None)]
    with pytest.raises(SqlError, match="permission denied"):
        db.sql("select nota from kk_receipts", sebagai={"role": "anon"})


def test_klaim_lama_gagal_tertutup(db):
    db.user("kasir@x.id", peran="kasir")
    db.sql("insert into kk_receipts(nota, total) values ('N-1', 30000)")
    db.sql("delete from kk_settings")
    m = db.member("6281200000001")
    assert db.sql("select kk_claim('N-1', 30000)->>'status'", sebagai=m) == [("not_found",)]
    assert db.sql("select claimed_by from kk_receipts") == [(None,)]


def test_kolam_dijalankan_ulang_tidak_mencabut_pos(db):
    kasir = db.user("kasir@x.id", peran="kasir")
    jalankan(db, "kolam/setup.sql")
    assert db.sql("select jsonb_typeof(pos_catalog())", sebagai=kasir) == [("object",)]
    assert db.sql("select jsonb_typeof(pos_my_notas())", sebagai=kasir) == [("array",)]
    assert db.sql("select has_function_privilege('authenticated', 'public.kk__use_voucher(text, uuid)', 'execute')") \
        == [("f",)]


def test_kasir_dijalankan_ulang(db):
    pemilik = aal2(db.user("pemilik@x.id", peran="pemilik"))
    db.sql("update storage.buckets set public = true where id = 'bukti'")
    db.sql("select pos_method_save('{\"name\":\"Gopay\",\"kind\":\"qris\"}')", sebagai=pemilik)
    db.sql("update pos_pay_methods set name = 'Cash' where kind = 'tunai'")
    jalankan(db, "kasir/setup.sql")
    jalankan(db, "kasir/setup.sql")
    assert db.sql("select public from storage.buckets where id = 'bukti'") == [("f",)]
    # metode bawaan tidak ditambahkan lagi kalau pemilik sudah punya daftar sendiri
    assert db.sql("select count(*) from pos_pay_methods") == [("4",)]
    assert db.sql("select count(*) from pos_pay_methods where name = 'Tunai'") == [("0",)]


def test_diskon_persen_maks_100(db):
    pemilik = aal2(db.user("pemilik@x.id", peran="pemilik"))
    with pytest.raises(SqlError, match="pos_discounts"):
        db.sql("select pos_discount_save('{\"name\":\"X\",\"kind\":\"persen\",\"value\":150}')", sebagai=pemilik)
    db.sql("select pos_discount_save('{\"name\":\"Y\",\"kind\":\"rupiah\",\"value\":150000}')", sebagai=pemilik)


def test_perangkat_panjang_ditolak(db):
    kasir = db.user("kasir@x.id", peran="kasir")
    with pytest.raises(SqlError, match="Kode perangkat terlalu panjang"):
        db.sql(f"select pos_device_request('{'x' * 65}', 'HP')", sebagai=kasir)
    with pytest.raises(SqlError, match="Nama perangkat terlalu panjang"):
        db.sql(f"select pos_device_request('dev1', '{'x' * 81}')", sebagai=kasir)
    assert db.sql(f"select pos_device_request('{'x' * 64}', '{'y' * 80}')", sebagai=kasir) == [("pending",)]
    assert db.sql("select count(*) from pos_audit where tbl = 'pos_devices'") == [("1",)]
    assert db.sql(f"select pos_device_request('{'x' * 64}', 'lagi')", sebagai=kasir) == [("pending",)]
    assert db.sql("select count(*) from pos_audit where tbl = 'pos_devices'") == [("1",)]
