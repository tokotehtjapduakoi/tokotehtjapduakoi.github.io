import hashlib
import json
import re
import uuid

import pytest

from db import SqlError, aal2

KODE = "ABCDE23456"


class Toko:
    """Toko siap jual: kasir + HP disetujui + shift terbuka + Teh Tarik 14 oz Rp15.000."""

    def __init__(self, db):
        self.db = db
        self.kasir = db.user("kasir@x.id", peran="kasir")
        self.pemilik = aal2(db.user("pemilik@x.id", peran="pemilik"))
        item = db.sql("select pos_item_save('{\"name\":\"Teh Tarik\"}')", sebagai=self.pemilik)[0][0]
        self.vid = int(db.sql(f"select pos_variant_save('{{\"item_id\":{item},\"name\":\"14 oz\",\"price\":15000}}')",
                              sebagai=self.pemilik)[0][0])
        db.sql("select pos_device_request('dev1','HP Kasir')", sebagai=self.kasir)
        db.sql("select pos_device_decide('dev1', true)", sebagai=self.pemilik)
        self.buka_shift(self.kasir)
        self.tunai = int(db.sql("select id from pos_pay_methods where kind='tunai'")[0][0])
        self.qris = int(db.sql("select id from pos_pay_methods where kind='qris'")[0][0])

    def buka_shift(self, kasir):
        """Buka shift lewat pos_shift_open; shift yang masih terbuka ditutup dulu (satu laci)."""
        self.db.sql("update pos_shifts set closed_at = now(), handover = false where closed_at is null")
        self.db.sql("select pos_shift_open('dev1', 0)", sebagai=kasir)
        # dibuka 5 hari lalu supaya nota offline berjam HP lampau jatuh di dalam shift
        self.db.sql(f"update pos_shifts set opened_at = now() - interval '5 days' where cashier = '{kasir['sub']}' "
                    "and closed_at is null")

    def foto(self, kasir, nama):
        self.db.sql(f"insert into storage.objects(bucket_id, name) values ('bukti', $n${nama}$n$)", sebagai=kasir)
        return nama

    def payload(self, kasir=None, foto=True, **ubah):
        kasir = kasir or self.kasir
        nid = ubah.pop("id", None) or str(uuid.uuid4())
        p = {"id": nid, "device": "dev1", "client_at": "now", "offline": False,
             "lines": [{"variant_id": self.vid, "qty": 2}], "discount_id": None, "voucher_code": None,
             "method_id": self.tunai, "total": 30000, "cash_received": 50000,
             "photo_path": f"{kasir['sub']}/{nid}.jpg", "customer_phone": None, "code": KODE}
        p.update(ubah)
        if foto and p["photo_path"] == f"{kasir['sub']}/{nid}.jpg":
            self.foto(kasir, p["photo_path"])
        return p

    def checkout(self, p, kasir=None):
        if p["client_at"] == "now":
            p = {**p, "client_at": self.db.sql("select now()")[0][0]}
        q = f"select pos_checkout($j${json.dumps(p)}$j$::jsonb)"
        return json.loads(self.db.sql(q, sebagai=kasir or self.kasir)[0][0])

    def ditolak(self, p, pesan, kasir=None):
        with pytest.raises(SqlError, match=pesan):
            self.checkout(p, kasir)


@pytest.fixture
def toko(db):
    return Toko(db)


def kode_hash(k):
    return hashlib.sha256(k.encode()).hexdigest()


def test_checkout_ok(db, toko):
    r = toko.checkout(toko.payload())
    assert r["total"] == 30000 and r["pulls"] == 1 and r["code_status"] == "aktif" and r["change"] == 20000
    assert re.match(r"^K\d{6}-001$", r["no"])
    assert db.sql(f"select change, subtotal, server_total, price_mismatch, held from pos_notas where id='{r['id']}'") \
        == [("20000", "30000", "30000", "f", "f")]
    assert db.sql("select nota, total, code_hash, created_by from kk_receipts") \
        == [(r["no"], "30000", kode_hash(KODE), toko.kasir["sub"])]
    assert db.sql("select item_name, variant_name, qty, price, free from pos_nota_lines") \
        == [("Teh Tarik", "14 oz", "2", "15000", "f")]
    # nomor urut harian
    r2 = toko.checkout(toko.payload(code="ABCDE23457"))
    assert r2["no"] == r["no"][:-3] + "002"


def test_checkout_idempoten(db, toko):
    p = toko.payload()
    a = toko.checkout(p)
    b = toko.checkout(p)
    assert a == b
    assert db.sql("select count(*) from pos_notas") == [("1",)]
    assert db.sql("select count(*) from kk_receipts") == [("1",)]
    # kasir lain tidak bisa memakai id yang sama
    lain = db.user("lain@x.id", peran="kasir")
    toko.buka_shift(lain)  # shift kasir pertama ditutup; id nota tetap milik kasir pertama
    toko.ditolak({**p, "photo_path": toko.foto(lain, f"{lain['sub']}/x.jpg")}, "ID nota sudah dipakai", lain)


def test_harga_dari_klien_diabaikan(db, toko):
    toko.ditolak(toko.payload(total=1000, cash_received=1000), "Harga berubah, muat ulang menu")
    assert db.sql("select count(*) from pos_notas") == [("0",)]


def mundurkan_harga(db, toko):
    """Harga 15.000 berlaku sejak 1 jam lalu; 16.000 berlaku mulai sekarang."""
    db.sql("update pos_price_history set valid_from = now() - interval '1 hour'")
    db.sql(f"select pos_variant_save('{{\"id\":{toko.vid},\"price\":16000}}')", sebagai=toko.pemilik)
    return db.sql("select now() - interval '30 minutes'")[0][0]


def test_offline_harga_lama(db, toko):
    dulu = mundurkan_harga(db, toko)
    r = toko.checkout(toko.payload(offline=True, client_at=dulu, lines=[{"variant_id": toko.vid, "qty": 1}],
                                   total=15000, cash_received=15000))
    assert db.sql(f"select total, server_total, price_mismatch, offline from pos_notas where id='{r['id']}'") \
        == [("15000", "15000", "f", "t")]
    # online memakai harga sekarang
    toko.ditolak(toko.payload(lines=[{"variant_id": toko.vid, "qty": 1}], total=15000, cash_received=15000,
                              code="ABCDE23457"), "Harga berubah")


def test_offline_harga_beda_ditandai(db, toko):
    dulu = mundurkan_harga(db, toko)
    r = toko.checkout(toko.payload(offline=True, client_at=dulu, lines=[{"variant_id": toko.vid, "qty": 1}],
                                   total=14000, cash_received=14000))
    assert r["total"] == 14000 and r["code_status"] == "aktif"
    assert db.sql(f"select total, server_total, price_mismatch from pos_notas where id='{r['id']}'") \
        == [("14000", "15000", "t")]
    assert db.sql("select total from kk_receipts") == [("14000",)]


def test_tanpa_foto_ditolak(db, toko):
    toko.ditolak(toko.payload(photo_path=""), "Foto bukti wajib")
    toko.ditolak(toko.payload(foto=False), "Foto bukti tidak ditemukan")  # path benar, belum diunggah
    toko.ditolak(toko.payload(foto=False, offline=True), "Foto bukti tidak ditemukan")


def test_foto_milik_orang_lain_ditolak(db, toko):
    lain = db.user("lain@x.id", peran="kasir")
    foto_lain = toko.foto(lain, f"{lain['sub']}/a.jpg")
    toko.ditolak(toko.payload(photo_path=foto_lain), "Foto bukti tidak ditemukan")
    # foto yang sudah dipakai nota lain tidak bisa dipakai lagi
    p = toko.payload()
    toko.checkout(p)
    toko.ditolak(toko.payload(photo_path=p["photo_path"], code="ABCDE23457"), "Foto bukti sudah dipakai")


def test_perangkat_belum_disetujui_ditolak(db, toko):
    toko.ditolak(toko.payload(device="baru"), "Perangkat belum disetujui")
    db.sql("select pos_device_request('dev2','HP baru')", sebagai=toko.kasir)
    toko.ditolak(toko.payload(device="dev2"), "Perangkat belum disetujui")
    toko.ditolak(toko.payload(device="dev2", offline=True), "Perangkat belum disetujui")
    # dicabut: online ditolak, offline sesudah dicabut ditolak
    db.sql("select pos_device_decide('dev1', false)", sebagai=toko.pemilik)
    toko.ditolak(toko.payload(), "Perangkat belum disetujui")
    toko.ditolak(toko.payload(offline=True), "Perangkat belum disetujui")


def test_perangkat_dicabut_offline_ditahan(db, toko):
    dulu = db.sql("select now() - interval '10 minutes'")[0][0]
    db.sql("select pos_device_decide('dev1', false)", sebagai=toko.pemilik)
    r = toko.checkout(toko.payload(offline=True, client_at=dulu))
    assert r["code_status"] == "ditahan"
    assert db.sql("select held from kk_receipts") == [("t",)]
    assert db.sql("select held from pos_notas") == [("t",)]
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'status'", sebagai=m) == [("pending",)]


def test_tanpa_shift_ditolak(db, toko):
    db.sql("update pos_shifts set closed_at = now()")
    toko.ditolak(toko.payload(), "Buka shift dulu")
    # shift terbuka milik kasir lain tidak dihitung
    lain = db.user("lain@x.id", peran="kasir")
    toko.buka_shift(lain)
    toko.ditolak(toko.payload(), "Buka shift dulu")


def test_kode_terikat_nomor_7_hari(db, toko):
    r = toko.checkout(toko.payload(customer_phone="0812-3456-7890"))
    assert db.sql("select bound_phone, expires_at - (select received_at from pos_notas) from kk_receipts") \
        == [("6281234567890", "7 days")]
    assert db.sql("select customer_phone from pos_notas") == [("6281234567890",)]
    assert r["expires_at"]
    toko.ditolak(toko.payload(customer_phone="12345", code="ABCDE23457"), "Nomor HP pelanggan tidak valid")


def test_kode_tanpa_nomor_2_jam(db, toko):
    toko.checkout(toko.payload())
    assert db.sql("select bound_phone, expires_at - (select received_at from pos_notas) from kk_receipts") \
        == [(None, "02:00:00")]


def test_kode_klaim_divalidasi(db, toko):
    for k in ("", None, "ABCDE2345", "ABCDE2345O", "ABCDE23451"):
        toko.ditolak(toko.payload(code=k), "Kode klaim tidak valid")
    toko.checkout(toko.payload())
    toko.ditolak(toko.payload(), "Kode bentrok, coba lagi")
    assert db.sql("select count(*) from pos_notas") == [("1",)]
    # kode dari nota POS bisa diklaim member
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'status'", sebagai=m) == [("ok",)]


def test_nota_terkunci(db, toko):
    r = toko.checkout(toko.payload())
    for q in ("update pos_notas set total = 1", "update pos_notas set method_id = method_id + 1",
              "delete from pos_notas", "update pos_nota_lines set qty = 9", "delete from pos_nota_lines"):
        with pytest.raises(SqlError, match="Nota terkunci"):
            db.sql(q)
    db.sql("update pos_notas set status = 'batal', voided_at = now(), held = true")  # kolom yang boleh berubah
    db.sql("update pos_notas set held = false")
    for q in ("update pos_notas set status = 'lunas'", "update pos_notas set voided_at = now() - interval '1 day'",
              "update pos_notas set voided_at = null"):
        with pytest.raises(SqlError, match="Nota terkunci"):
            db.sql(q)
    assert db.sql("select total, status, held from pos_notas") == [(str(r["total"]), "batal", "f")]
    for t in ("pos_notas", "pos_nota_lines", "pos_counters", "pos_shifts"):
        with pytest.raises(SqlError, match="permission denied"):
            db.sql(f"update {t} set id = id" if t != "pos_counters" else f"update {t} set seq = 0",
                   sebagai=toko.kasir)
    # tidak ada fungsi pos_* yang bisa dipanggil klien selain daftar yang diketahui
    klien = {r[0] for r in db.sql(
        "select p.proname from pg_proc p where p.pronamespace='public'::regnamespace and p.proname like 'pos%' "
        "and has_function_privilege('authenticated', p.oid, 'execute')")}
    assert klien == {"pos_device_request", "pos_devices_list", "pos_device_decide", "pos_catalog", "pos_catalog_all", "pos_item_save",
                     "pos_variant_save", "pos_method_save", "pos_discount_save", "pos_me", "pos_checkout",
                     "pos_my_notas", "pos_shift_open", "pos_shift_close", "pos_shift_receive",
                     "pos_void_request", "pos_void_pending", "pos_void_decide", "pos_report"}


def voucher(db, kode="TK-ABCDE"):
    m = db.member("6281200000002")
    db.sql(f"insert into kk_exchanges(member_id, kind, item, points, code) values "
           f"('{m['sub']}', 'hadiah', '1 minuman 14 oz gratis', 30, '{kode}')")
    return kode


def test_voucher_dipakai_sekali(db, toko):
    v = voucher(db)
    r = toko.checkout(toko.payload(voucher_code=v.lower(), total=15000, cash_received=20000))
    assert r["total"] == 15000 and r["change"] == 5000
    assert db.sql("select qty, price, free from pos_nota_lines order by free") \
        == [("1", "15000", "f"), ("1", "0", "t")]
    assert db.sql("select used_at is not null, used_by from kk_exchanges") == [("t", toko.kasir["sub"])]
    assert db.sql("select voucher_code, subtotal from pos_notas") == [(v, "15000")]
    toko.ditolak(toko.payload(voucher_code=v, total=15000, cash_received=20000, code="ABCDE23457"),
                 "Voucher tidak ada atau sudah dipakai")
    v2 = "TK-FGHJK"
    db.sql(f"insert into kk_exchanges(member_id, kind, item, points, code) select member_id, 'hadiah', 'x', 30, '{v2}' "
           "from kk_exchanges limit 1")
    toko.ditolak(toko.payload(voucher_code=v2, offline=True, total=15000, cash_received=20000, code="ABCDE23458"),
                 "Voucher tidak bisa dipakai saat offline")
    assert db.sql(f"select used_at from kk_exchanges where code='{v2}'") == [(None,)]
    assert db.sql("select count(*) from pos_notas") == [("1",)]


def test_semua_gratis_tanpa_kode(db, toko):
    v = voucher(db)
    r = toko.checkout(toko.payload(voucher_code=v, lines=[{"variant_id": toko.vid, "qty": 1}], total=0,
                                   cash_received=0, code=None))
    assert r["total"] == 0 and r["pulls"] == 0 and r["code_status"] == "tidak_ada" and r["expires_at"] is None
    assert db.sql("select count(*) from kk_receipts") == [("0",)]
    assert db.sql("select free from pos_nota_lines") == [("t",)]
    # total 0 untuk barang berbayar ditolak
    toko.ditolak(toko.payload(offline=True, total=0, cash_received=0), "Total tidak boleh 0")


def test_tunai_kurang_ditolak(db, toko):
    toko.ditolak(toko.payload(cash_received=20000), "Uang diterima kurang")
    toko.ditolak(toko.payload(cash_received=None), "Uang diterima kurang")
    r = toko.checkout(toko.payload(method_id=toko.qris, cash_received=None))
    assert db.sql(f"select cash_received, change from pos_notas where id='{r['id']}'") == [(None, None)]


def test_diskon(db, toko):
    d = db.sql("select pos_discount_save('{\"name\":\"Teman\",\"kind\":\"persen\",\"value\":15}')",
               sebagai=toko.pemilik)[0][0]
    # 3 x 15.000 = 45.000; 15% = 6.750 -> 38.250
    r = toko.checkout(toko.payload(lines=[{"variant_id": toko.vid, "qty": 3}], discount_id=int(d), total=38250))
    assert db.sql(f"select subtotal, discount_amt, server_total from pos_notas where id='{r['id']}'") \
        == [("45000", "6750", "38250")]
    assert db.sql("select new->>'amount' from pos_audit where tbl='pos_notas' and action='diskon'") == [("6750",)]


def test_kasir_saja(db, toko):
    m = db.member("6281200000001")
    with pytest.raises(SqlError, match="Khusus kasir"):
        toko.checkout(toko.payload(), m)
    with pytest.raises(SqlError, match="permission denied"):
        toko.checkout(toko.payload(), {"role": "anon"})


def test_nota_shift_saya(db, toko):
    a = toko.checkout(toko.payload())
    b = toko.checkout(toko.payload(code="ABCDE23457", method_id=toko.qris, cash_received=None))
    rows = json.loads(db.sql("select pos_my_notas()", sebagai=toko.kasir)[0][0])
    assert [x["no"] for x in rows] == [b["no"], a["no"]]
    assert rows[0]["method"] == "QRIS" and rows[0]["total"] == 30000 and rows[0]["status"] == "lunas"
    assert rows[0]["has_void_request"] is False
    # rincian untuk layar Nota kasir: foto bukti dan baris nota
    assert rows[0]["photo_path"] and rows[0]["photo_path"] != rows[1]["photo_path"]
    assert len(rows[0]["lines"]) == 1 and set(rows[0]["lines"][0]) == {"item", "variant", "qty", "price", "free"}
    assert sum(l["qty"] * l["price"] for l in rows[0]["lines"]) == rows[0]["total"]
    # shift berikutnya (kasir lain) hanya melihat notanya sendiri; shift kasir pertama sudah tertutup
    lain = db.user("lain@x.id", peran="kasir")
    toko.buka_shift(lain)
    c = toko.checkout(toko.payload(kasir=lain, code="ABCDE23458"), lain)
    assert [x["no"] for x in json.loads(db.sql("select pos_my_notas()", sebagai=lain)[0][0])] == [c["no"]]
    assert db.sql("select pos_my_notas()", sebagai=toko.kasir) == [("[]",)]


def test_jam_hp_di_masa_depan_ditolak(db, toko):
    nanti = db.sql("select now() + interval '1 hour'")[0][0]
    toko.ditolak(toko.payload(client_at=nanti, offline=True), "Jam HP tidak sesuai")


def test_offline_total_besar_tidak_menambah_tarikan(db, toko):
    # server: 2 x 15.000 = 30.000 (1 tarikan); HP mengaku 150.000 (5 tarikan)
    r = toko.checkout(toko.payload(offline=True, total=150000, cash_received=150000))
    assert r["total"] == 150000 and r["pulls"] == 1 and r["code_status"] == "aktif"
    assert db.sql("select total, server_total, price_mismatch from pos_notas") == [("150000", "30000", "t")]
    assert db.sql("select total from kk_receipts") == [("30000",)]
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'pulls'", sebagai=m) == [("1",)]


def test_offline_total_kecil_dipakai(db, toko):
    r = toko.checkout(toko.payload(offline=True, total=25000, cash_received=25000))
    assert r["pulls"] == 1
    assert db.sql("select total from kk_receipts") == [("25000",)]


def test_nota_lebih_3_hari_ditolak(db, toko):
    lama = db.sql("select now() - interval '4 days'")[0][0]
    toko.ditolak(toko.payload(client_at=lama, offline=True), "lebih dari 3 hari")


def test_nota_pos_tidak_bisa_dihapus_atau_ditiru(db, toko):
    r = toko.checkout(toko.payload())
    with pytest.raises(SqlError, match="Nota tidak ada atau sudah diklaim"):
        db.sql(f"select kk_delete_receipt('{r['no']}')", sebagai=toko.pemilik)
    assert db.sql("select count(*) from kk_receipts") == [("1",)]
    # format nomor POS tidak boleh dipakai nota manual (bisa memblokir checkout hari itu)
    besok = r["no"][:-3] + "002"
    with pytest.raises(SqlError, match="khusus POS"):
        db.sql(f"select kk_add_receipt('{besok.lower()}', 30000)", sebagai=toko.pemilik)
    n = db.sql(f"select kk_add_receipts('[{{\"nota\":\"{besok}\",\"total\":30000}},"
               f"{{\"nota\":\" k261125-9 \",\"total\":30000}},{{\"nota\":\"ESB-1\",\"total\":30000}}]'::jsonb)",
               sebagai=toko.pemilik)
    assert n == [("1",)]
    assert db.sql("select nota from kk_receipts order by nota") == [("ESB-1",), (r["no"],)]
    # nota manual biasa masih bisa dihapus
    db.sql("select kk_delete_receipt('ESB-1')", sebagai=toko.pemilik)
    assert toko.checkout(toko.payload(code="ABCDE23457"))["no"] == besok
