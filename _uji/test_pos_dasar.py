import pytest

from db import SqlError, aal2

TABEL = ["pos_devices", "pos_items", "pos_variants", "pos_price_history",
         "pos_pay_methods", "pos_discounts", "pos_audit"]


def siapkan(db):
    kasir = db.user("kasir@x.id", peran="kasir")
    pemilik = db.user("pemilik@x.id", peran="pemilik")
    return kasir, aal2(pemilik)


def ditolak(db, q, sebagai):
    with pytest.raises(SqlError):
        db.sql(q, sebagai=sebagai)


@pytest.mark.parametrize("t", TABEL)
def test_tabel_tidak_bisa_ditulis_klien(db, t):
    kasir, _ = siapkan(db)
    kol = "variant_id" if t == "pos_price_history" else "id"
    for q in (f"insert into {t} default values", f"update {t} set {kol} = {kol}", f"delete from {t}"):
        with pytest.raises(SqlError, match="permission denied"):
            db.sql(q, sebagai=kasir)
    try:
        assert db.sql(f"select * from {t}", sebagai=kasir) == []
    except SqlError as e:
        assert "permission denied" in str(e)


def test_semua_tabel_rls(db):
    assert db.sql("select relname from pg_class where relnamespace='public'::regnamespace "
                  "and relkind='r' and not relrowsecurity") == []


def test_perangkat_baru_pending_lalu_disetujui(db):
    kasir, pemilik = siapkan(db)
    assert db.sql("select pos_device_request('dev1','HP Ocha')", sebagai=kasir) == [("pending",)]
    assert db.sql("select pos_me('dev1')->>'device'", sebagai=kasir) == [("pending",)]
    db.sql("select pos_device_decide('dev1', true)", sebagai=pemilik)
    assert db.sql("select pos_me('dev1')->>'device'", sebagai=kasir) == [("approved",)]
    assert db.sql("select count(*) from pos_audit where tbl='pos_devices'") != [("0",)]
    assert db.sql("select pos_me('lain')->>'device'", sebagai=kasir) == [("unknown",)]
    db.sql("select pos_device_decide('dev1', false)", sebagai=pemilik)
    assert db.sql("select pos_device_request('dev1','x')", sebagai=kasir) == [("revoked",)]


def test_kasir_tidak_bisa_setujui_perangkat(db):
    kasir, _ = siapkan(db)
    db.sql("select pos_device_request('dev1','HP')", sebagai=kasir)
    ditolak(db, "select pos_device_decide('dev1', true)", kasir)


def test_pemilik_tanpa_aal2_ditolak(db):
    kasir, pemilik = siapkan(db)
    aal1 = {**pemilik, "aal": "aal1"}
    ditolak(db, "select pos_item_save('{\"name\":\"Teh\"}')", aal1)
    ditolak(db, "select pos_devices_list()", aal1)


def test_ubah_harga_tercatat(db):
    _, pemilik = siapkan(db)
    item = db.sql("select pos_item_save('{\"name\":\"Teh Tarik\",\"category\":\"Minuman\"}')", sebagai=pemilik)[0][0]
    vid = db.sql(f"select pos_variant_save('{{\"item_id\":{item},\"name\":\"14 oz\",\"price\":15000}}')",
                 sebagai=pemilik)[0][0]
    db.sql(f"select pos_variant_save('{{\"id\":{vid},\"price\":16000}}')", sebagai=pemilik)
    assert db.sql(f"select count(*) from pos_price_history where variant_id={vid}") == [("2",)]
    assert db.sql("select old->>'price', new->>'price' from pos_audit "
                  f"where tbl='pos_variants' and row_id='{vid}' and old is not null") == [("15000", "16000")]


def test_katalog_hanya_aktif(db):
    kasir, pemilik = siapkan(db)
    a = db.sql("select pos_item_save('{\"name\":\"Aktif\"}')", sebagai=pemilik)[0][0]
    b = db.sql("select pos_item_save('{\"name\":\"Mati\"}')", sebagai=pemilik)[0][0]
    db.sql(f"select pos_variant_save('{{\"item_id\":{a},\"name\":\"S\",\"price\":1000}}')", sebagai=pemilik)
    db.sql(f"select pos_variant_save('{{\"item_id\":{b},\"name\":\"S\",\"price\":1000}}')", sebagai=pemilik)
    db.sql(f"select pos_item_save('{{\"id\":{b},\"active\":false}}')", sebagai=pemilik)
    nama = db.sql("select i->>'name' from jsonb_array_elements(pos_catalog()->'items') i", sebagai=kasir)
    assert nama == [("Aktif",)]
    assert db.sql("select jsonb_array_length(pos_catalog()->'methods')", sebagai=kasir) == [("3",)]
    v1 = db.sql("select pos_catalog()->>'version'", sebagai=kasir)
    db.sql(f"select pos_item_save('{{\"id\":{a},\"name\":\"Baru\"}}')", sebagai=pemilik)
    assert db.sql("select pos_catalog()->>'version'", sebagai=kasir) != v1


def test_anon_tidak_bisa_katalog(db):
    ditolak(db, "select pos_catalog()", {"role": "anon"})


def test_metode_dan_diskon(db):
    kasir, pemilik = siapkan(db)
    db.sql("select pos_method_save('{\"name\":\"Gopay\",\"kind\":\"qris\"}')", sebagai=pemilik)
    d = db.sql("select pos_discount_save('{\"name\":\"Member\",\"kind\":\"persen\",\"value\":10}')", sebagai=pemilik)[0][0]
    assert db.sql("select count(*) from pos_audit where tbl in ('pos_pay_methods','pos_discounts')") == [("2",)]
    ditolak(db, "select pos_discount_save('{\"name\":\"X\",\"kind\":\"persen\",\"value\":10}')", kasir)
    assert db.sql("select pos_catalog()->'discounts'->0->>'name'", sebagai=kasir) == [("Member",)]
    assert d


def test_storage_folder_sendiri(db):
    kasir, _ = siapkan(db)
    lain = db.user("lain@x.id", peran="kasir")
    db.sql(f"insert into storage.objects(bucket_id,name) values ('bukti','{kasir['sub']}/a.jpg')", sebagai=kasir)
    ditolak(db, f"insert into storage.objects(bucket_id,name) values ('bukti','{lain['sub']}/a.jpg')", kasir)
    # tanpa policy update: RLS menyaring semua baris, tidak ada yang berubah
    db.sql(f"update storage.objects set name='{kasir['sub']}/b.jpg'", sebagai=kasir)
    db.sql("delete from storage.objects", sebagai=kasir)
    assert db.sql("select name from storage.objects") == [(f"{kasir['sub']}/a.jpg",)]
    assert db.sql("select count(*) from storage.objects", sebagai=kasir) == [("1",)]
    member = db.member("6281200000009")
    assert db.sql("select count(*) from storage.objects", sebagai=member) == [("0",)]


def test_katalog_lengkap_khusus_pemilik_aal2(db):
    kasir, pemilik = siapkan(db)
    mid = db.sql("select pos_item_save('{\"name\":\"Teh\"}')", sebagai=pemilik)[0][0]
    db.sql(f"select pos_variant_save('{{\"item_id\":{mid},\"name\":\"14 oz\",\"price\":15000}}')", sebagai=pemilik)
    db.sql(f"select pos_item_save('{{\"id\":{mid},\"active\":false}}')", sebagai=pemilik)
    assert db.sql("select jsonb_array_length(pos_catalog()->'items')", sebagai=kasir) == [("0",)]
    assert db.sql("select pos_catalog_all()->'items'->0->>'active'", sebagai=pemilik) == [("false",)]
    assert db.sql("select jsonb_array_length(pos_catalog_all()->'items'->0->'variants')", sebagai=pemilik) == [("1",)]
    ditolak(db, "select pos_catalog_all()", kasir)
    ditolak(db, "select pos_catalog_all()", {**pemilik, "aal": "aal1"})
