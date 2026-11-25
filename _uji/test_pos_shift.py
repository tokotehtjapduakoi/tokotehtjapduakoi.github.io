import json

import pytest

from db import SqlError, aal2


class Laci:
    """Dua kasir + pemilik, HP dev1 disetujui, Teh Tarik Rp15.000. Belum ada shift."""

    def __init__(self, db):
        self.db = db
        self.a = db.user("a@x.id", peran="kasir")
        self.b = db.user("b@x.id", peran="kasir")
        self.pemilik = aal2(db.user("pemilik@x.id", peran="pemilik"))
        item = db.sql("select pos_item_save('{\"name\":\"Teh Tarik\"}')", sebagai=self.pemilik)[0][0]
        self.vid = int(db.sql(f"select pos_variant_save('{{\"item_id\":{item},\"name\":\"14 oz\",\"price\":15000}}')",
                              sebagai=self.pemilik)[0][0])
        db.sql("select pos_device_request('dev1','HP Kasir')", sebagai=self.a)
        db.sql("select pos_device_decide('dev1', true)", sebagai=self.pemilik)
        self.tunai = int(db.sql("select id from pos_pay_methods where kind='tunai'")[0][0])
        self.n = 0

    def buka(self, kasir, modal, device="dev1"):
        return json.loads(self.db.sql(f"select pos_shift_open('{device}', {modal})", sebagai=kasir)[0][0])

    def foto(self, kasir, nama=None):
        self.n += 1
        nama = f"{kasir['sub']}/{nama or f'tutup{self.n}'}.jpg"
        self.db.sql(f"insert into storage.objects(bucket_id, name) values ('bukti', $n${nama}$n$)", sebagai=kasir)
        return nama

    def tutup(self, kasir, hitung, serah, foto=None):
        foto = foto or self.foto(kasir)
        return json.loads(self.db.sql(f"select pos_shift_close({hitung}, $f${foto}$f$, {str(serah).lower()})",
                                      sebagai=kasir)[0][0])

    def terima(self, kasir, hitung, device="dev1"):
        return json.loads(self.db.sql(f"select pos_shift_receive('{device}', {hitung})", sebagai=kasir)[0][0])

    def jual(self, kasir, shift, total, kind="tunai", foto=None):
        """Sisipkan nota lunas langsung (uji ini hanya soal shift; checkout diuji di test_pos_checkout)."""
        self.n += 1
        mid = self.db.sql(f"select id from pos_pay_methods where kind='{kind}' limit 1")[0][0]
        self.db.sql(
            "insert into pos_notas(id, no, cashier, device, shift_id, client_at, subtotal, total, server_total, "
            f"method_id, photo_path) values (gen_random_uuid(), 'T{self.n}', '{kasir['sub']}', 'dev1', {shift}, now(), "
            f"{total}, {total}, {total}, {mid}, $f${foto or f'n{self.n}'}$f$)")


@pytest.fixture
def laci(db):
    return Laci(db)


def ditolak(db, q, pesan, sebagai):
    with pytest.raises(SqlError, match=pesan):
        db.sql(q, sebagai=sebagai)


def test_buka_jual_tutup(db, laci):
    s = laci.buka(laci.a, 100000)
    assert s["cash_start"] == 100000
    laci.jual(laci.a, s["id"], 30000)
    laci.jual(laci.a, s["id"], 20000, kind="qris")  # non-tunai tidak dihitung
    laci.tutup(laci.a, 130000, False)
    assert db.sql(f"select pos_shift_expected({s['id']})") == [("130000",)]
    assert db.sql("select cash_counted, handover, closed_at is not null from pos_shifts") == [("130000", "f", "t")]
    # nota batal tidak dihitung
    db.sql("update pos_notas set status='batal', voided_at=now() where no='T1'")
    assert db.sql(f"select pos_shift_expected({s['id']})") == [("100000",)]


def test_shift_ganda_ditolak(db, laci):
    laci.buka(laci.a, 0)
    ditolak(db, "select pos_shift_open('dev1', 0)", "Masih ada shift terbuka", laci.b)
    ditolak(db, "select pos_shift_open('dev1', 0)", "Masih ada shift terbuka", laci.a)
    laci.tutup(laci.a, 0, False)
    with pytest.raises(SqlError, match="Tidak ada shift terbuka"):
        laci.tutup(laci.a, 0, False)
    # setelah tutup toko, shift baru boleh
    laci.buka(laci.b, 50000)
    # basis data juga menjaga: dua shift terbuka tak bisa disisipkan langsung
    with pytest.raises(SqlError, match="pos_shifts_satu_laci"):
        db.sql(f"insert into pos_shifts(cashier, device, cash_start) values ('{laci.a['sub']}', 'dev1', 0)")


def test_serah_terima(db, laci):
    laci.buka(laci.a, 100000)
    laci.tutup(laci.a, 130000, True)
    me = json.loads(db.sql("select pos_me('dev1')", sebagai=laci.b)[0][0])
    assert me["shift"] is None
    assert me["handover_waiting"] == {"shift_id": 1, "is_mine": False, "cashier_name": "a@x.id"}  # hitungan buta untuk kasir
    own = json.loads(db.sql("select pos_me('dev1')", sebagai=laci.pemilik)[0][0])
    assert own["handover_waiting"] == {"shift_id": 1, "is_mine": False, "cashier_name": "a@x.id", "cash_counted": 130000}
    mine = json.loads(db.sql("select pos_me('dev1')", sebagai=laci.a)[0][0])
    assert mine["handover_waiting"]["is_mine"] is True
    r = laci.terima(laci.b, 125000)
    assert r["selisih"] == -5000 and r["shift"]["cash_start"] == 125000
    assert db.sql("select cashier = '%s', cash_start, received_from from pos_shifts where closed_at is null"
                  % laci.b["sub"]) == [("t", "125000", "1")]
    assert db.sql("select received_count, received_by = '%s', received_at is not null from pos_shifts where id=1"
                  % laci.b["sub"]) == [("125000", "t", "t")]
    me = json.loads(db.sql("select pos_me('dev1')", sebagai=laci.b)[0][0])
    assert me["shift"]["cash_start"] == 125000 and me["handover_waiting"] is None
    assert json.loads(db.sql("select pos_me('dev1')", sebagai=laci.a)[0][0])["shift"] is None
    # sudah diterima: tidak bisa diterima lagi
    ditolak(db, "select pos_shift_receive('dev1', 1)", "Tidak ada serah terima", laci.pemilik)


def test_tidak_bisa_terima_sendiri(db, laci):
    laci.buka(laci.a, 0)
    ditolak(db, "select pos_shift_receive('dev1', 0)", "Tidak ada serah terima", laci.b)  # belum ditutup
    laci.tutup(laci.a, 10000, True)
    ditolak(db, "select pos_shift_receive('dev1', 10000)", "diterima kasir lain", laci.a)
    assert db.sql("select count(*) from pos_shifts") == [("1",)]


def test_pemilik_boleh_menerima(db, laci):
    laci.buka(laci.a, 0)
    laci.tutup(laci.a, 10000, True)
    r = laci.terima(laci.pemilik, 10000)
    assert r["selisih"] == 0


def test_tutup_toko_tidak_bisa_diterima(db, laci):
    laci.buka(laci.a, 0)
    laci.tutup(laci.a, 10000, False)
    ditolak(db, "select pos_shift_receive('dev1', 10000)", "Tidak ada serah terima", laci.b)
    assert json.loads(db.sql("select pos_me('dev1')", sebagai=laci.b)[0][0])["handover_waiting"] is None


def test_buka_ditolak_saat_menunggu_diterima(db, laci):
    laci.buka(laci.a, 0)
    laci.tutup(laci.a, 10000, True)
    ditolak(db, "select pos_shift_open('dev1', 0)", "serah terima kas yang menunggu", laci.b)
    ditolak(db, "select pos_shift_open('dev1', 0)", "serah terima kas yang menunggu", laci.a)
    with pytest.raises(SqlError, match="pos_shifts_satu_laci"):
        db.sql(f"insert into pos_shifts(cashier, device, cash_start) values ('{laci.b['sub']}', 'dev1', 0)")


def test_tutup_tanpa_foto_ditolak(db, laci):
    s = laci.buka(laci.a, 0)
    for foto in ("", "   ", None):
        arg = "null" if foto is None else f"$f${foto}$f$"
        ditolak(db, f"select pos_shift_close(0, {arg}, false)", "Foto bukti wajib", laci.a)
    ditolak(db, f"select pos_shift_close(0, '{laci.a['sub']}/belum.jpg', false)", "Foto bukti tidak ditemukan", laci.a)
    # foto milik kasir lain
    fb = laci.foto(laci.b)
    ditolak(db, f"select pos_shift_close(0, '{fb}', false)", "Foto bukti tidak ditemukan", laci.a)
    assert db.sql(f"select closed_at from pos_shifts where id={s['id']}") == [(None,)]
    # foto tutup shift tak bisa dipakai lagi oleh shift lain, juga bukan foto nota
    laci.tutup(laci.a, 0, True)
    laci.terima(laci.b, 0)
    pakai = laci.foto(laci.b)
    db.sql(f"update pos_shifts set close_photo = $f${pakai}$f$ where id = {s['id']}")
    ditolak(db, f"select pos_shift_close(0, '{pakai}', false)", "Foto bukti sudah dipakai", laci.b)
    db.sql(f"update pos_shifts set close_photo = null where id = {s['id']}")
    laci.jual(laci.b, 2, 1000, foto=pakai)
    ditolak(db, f"select pos_shift_close(0, '{pakai}', false)", "Foto bukti sudah dipakai", laci.b)


def test_validasi_dan_perangkat(db, laci):
    ditolak(db, "select pos_shift_open('dev1', -1)", "Modal awal tidak valid", laci.a)
    ditolak(db, "select pos_shift_open('dev1', null)", "Modal awal tidak valid", laci.a)
    ditolak(db, "select pos_shift_open('asing', 0)", "Perangkat belum disetujui", laci.a)
    laci.buka(laci.a, 0)
    ditolak(db, f"select pos_shift_close(-1, '{laci.foto(laci.a)}', false)", "Hitungan uang tidak valid", laci.a)
    laci.tutup(laci.a, 0, True)
    ditolak(db, "select pos_shift_receive('asing', 0)", "Perangkat belum disetujui", laci.b)
    ditolak(db, "select pos_shift_receive('dev1', -5)", "Hitungan uang tidak valid", laci.b)
    # member biasa ditolak
    m = db.member("6281200000001")
    for q in ("select pos_shift_open('dev1', 0)", "select pos_shift_close(0, 'x', false)",
              "select pos_shift_receive('dev1', 0)"):
        ditolak(db, q, "Khusus kasir", m)
    # fungsi internal tidak bisa dipanggil klien
    for q in ("select pos_shift_expected(1)", "select pos__photo_ok('x')", "select pos__shift_out(1)"):
        ditolak(db, q, "permission denied", laci.a)


def checkout_payload(laci, kasir, client_at, offline, foto):
    import uuid
    nid = str(uuid.uuid4())
    return {"id": nid, "device": "dev1", "client_at": client_at, "offline": offline,
            "lines": [{"variant_id": laci.vid, "qty": 2}], "discount_id": None, "voucher_code": None,
            "method_id": laci.tunai, "total": 30000, "cash_received": 30000, "photo_path": foto,
            "customer_phone": None, "code": "ABCDE23456"}


def kirim(db, kasir, p):
    return json.loads(db.sql(f"select pos_checkout($j${json.dumps(p)}$j$::jsonb)", sebagai=kasir)[0][0])


def test_nota_offline_masuk_shift_yang_sudah_tutup(db, laci):
    s = laci.buka(laci.a, 100000)
    db.sql(f"update pos_shifts set opened_at = now() - interval '2 hours' where id = {s['id']}")
    dulu = db.sql("select now() - interval '1 hour'")[0][0]
    laci.tutup(laci.a, 100000, True)
    laci.terima(laci.b, 100000)  # shift baru milik B; A tak punya shift terbuka
    r = kirim(db, laci.a, checkout_payload(laci, laci.a, dulu, True, laci.foto(laci.a)))
    assert db.sql(f"select shift_id from pos_notas where id='{r['id']}'") == [(str(s["id"]),)]
    assert db.sql(f"select pos_shift_expected({s['id']})") == [("130000",)]
    # client_at di luar shift mana pun milik A: ditolak
    lama = db.sql("select now() - interval '3 hours'")[0][0]
    with pytest.raises(SqlError, match="Tidak ada shift saat nota dibuat"):
        kirim(db, laci.a, {**checkout_payload(laci, laci.a, lama, True, laci.foto(laci.a)), "code": "ABCDE23457"})
    # online tanpa shift terbuka: tetap ditolak
    with pytest.raises(SqlError, match="Buka shift dulu"):
        kirim(db, laci.a, {**checkout_payload(laci, laci.a, db.sql("select now()")[0][0], False,
                                               laci.foto(laci.a)), "code": "ABCDE23458"})


def test_foto_tutup_shift_tak_bisa_dipakai_nota(db, laci):
    laci.buka(laci.a, 0)
    foto = laci.foto(laci.a)
    laci.tutup(laci.a, 0, True, foto=foto)
    laci.terima(laci.b, 0)
    # kasir A membuka lagi nanti; foto tutup miliknya dipakai nota -> ditolak
    laci.tutup(laci.b, 0, False)
    laci.buka(laci.a, 0)
    with pytest.raises(SqlError, match="Foto bukti sudah dipakai"):
        kirim(db, laci.a, checkout_payload(laci, laci.a, db.sql("select now()")[0][0], False, foto))
