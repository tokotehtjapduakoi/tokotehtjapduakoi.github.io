"""Teman Tarik (kode ajak) & bonus posting dari main, digabung dengan aturan keamanan Kasir Koi."""
import json
import subprocess

import pytest

from db import AKAR, Db, SqlError, aal2
from test_kolam_kode import KODE, siapkan
from test_pos_checkout import Toko
from test_pos_void import ajukan, putuskan

INTERNAL_BARU = ["kk__prog", "kk__voucher_code", "kk__new_ref_code", "kk__give_bonus", "kk__pulls"]
NAMA_LAMA = ["kk_prog", "kk_voucher_code", "kk_new_ref_code", "kk_give_bonus", "kk_do_pulls"]


def boleh(db, peran, sig):
    return db.sql(f"select has_function_privilege('{peran}', '{sig}', 'execute')")[0][0] == "t"


def j(db, q, siapa):
    return json.loads(db.sql(q, sebagai=siapa)[0][0])


# ---------- hak fungsi ----------
@pytest.mark.parametrize("f", INTERNAL_BARU)
def test_pembantu_program_internal(db, f):
    for peran in ("anon", "authenticated"):
        hasil = db.sql(f"select bool_or(has_function_privilege('{peran}', p.oid, 'execute')) from pg_proc p "
                       f"where p.pronamespace = 'public'::regnamespace and p.proname = '{f}'")
        assert hasil == [("f",)], (f, peran)


def test_nama_pembantu_lama_tidak_ada(db):
    lama = ",".join(f"'{n}'" for n in NAMA_LAMA)
    assert db.sql(f"select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ({lama})") \
        == [("0",)]


def test_hak_fungsi_teman_tarik(db):
    assert boleh(db, "anon", "public.kk_ref_check(text)")
    assert boleh(db, "authenticated", "public.kk_ref_check(text)")
    for sig in ("public.kk_use_ref(text)", "public.kk_pull_bonus()", "public.kk_posting_status(text)",
                "public.kk_posting_bonus(text, text, text)"):
        assert boleh(db, "authenticated", sig), sig
        assert not boleh(db, "anon", sig), sig
        assert not boleh(db, "public", sig), sig


def test_anon_hanya_dua_fungsi_kk(db):
    hasil = db.sql("select string_agg(p.proname, ',' order by p.proname) from pg_proc p "
                   "where p.pronamespace = 'public'::regnamespace and p.proname like 'kk%' "
                   "and has_function_privilege('anon', p.oid, 'execute')")
    assert hasil == [("kk_board,kk_ref_check",)]


def test_posting_khusus_staf_tanpa_2_langkah(db):
    kasir = db.user("kasir@x.id", peran="kasir")  # aal1: tugas kasir, bukan fungsi pemilik
    m = db.member("6281200000001")
    for q in ("select kk_posting_status('6281200000001')",
              "select kk_posting_bonus('6281200000001', 'esteh', '')"):
        with pytest.raises(SqlError, match="Khusus kasir"):
            db.sql(q, sebagai=m)
        with pytest.raises(SqlError, match="permission denied"):
            db.sql(q, sebagai={"role": "anon"})
    assert j(db, "select kk_posting_status('6281200000001')", kasir)["today"] is False


# ---------- tabel baru ----------
@pytest.mark.parametrize("t", ["kk_program", "kk_posts"])
def test_tabel_baru_rls_dan_hak(db, t):
    assert db.sql(f"select relrowsecurity from pg_class where oid = 'public.{t}'::regclass") == [("t",)]
    for peran in ("anon", "authenticated"):
        for hak in ("insert", "update", "delete", "truncate"):
            assert db.sql(f"select has_table_privilege('{peran}', 'public.{t}', '{hak}')") == [("f",)], (peran, hak)
    for hak in ("select", "insert", "update", "delete"):
        assert db.sql(f"select has_table_privilege('service_role', 'public.{t}', '{hak}')") == [("t",)], hak


def test_sequence_kk_posts_tertutup(db):
    for peran in ("anon", "authenticated"):
        for hak in ("usage", "select", "update"):
            assert db.sql(f"select has_sequence_privilege('{peran}', 'public.kk_posts_id_seq', '{hak}')") \
                == [("f",)], (peran, hak)


def test_kk_posts_hanya_milik_sendiri(db):
    kasir = db.user("kasir@x.id", peran="kasir")
    a, b = db.member("6281200000001"), db.member("6281200000002")
    db.sql(f"insert into kk_posts(member_id, choice) values ('{a['sub']}', 'esteh'), ('{b['sub']}', 'tarik')")
    assert db.sql("select count(*) from kk_posts", sebagai=a) == [("1",)]
    assert db.sql("select count(*) from kk_posts", sebagai=kasir) == [("2",)]
    with pytest.raises(SqlError, match="permission denied"):
        db.sql("select count(*) from kk_posts", sebagai={"role": "anon"})
    with pytest.raises(SqlError, match="permission denied"):
        db.sql(f"insert into kk_posts(member_id, choice) values ('{a['sub']}', 'esteh')", sebagai=a)


# ---------- Teman Tarik lewat klaim kode (kk_claim_code -> kk__draw) ----------
def pasang_ajak(db, teman, pengajak):
    kode = db.sql(f"select ref_code from kk_members where user_id = '{pengajak['sub']}'")[0][0]
    db.sql(f"select kk_use_ref('{kode}')", sebagai=teman)


def bonus(db, siapa):
    return db.sql(f"select count(*) from kk_exchanges where kind = 'bonus' and member_id = '{siapa['sub']}'")[0][0]


def test_ajak_lewat_kode_pos(db):
    siapkan(db)
    pengajak, teman = db.member("6281200000001"), db.member("6281200000002")
    pasang_ajak(db, teman, pengajak)
    r = j(db, f"select kk_claim_code('{KODE}')", teman)
    assert r["status"] == "ok" and r["ajak"]["code"].startswith("TK-")
    assert (bonus(db, teman), bonus(db, pengajak)) == ("1", "1")
    assert db.sql(f"select ref_paid, ref_done_at is not null from kk_members where user_id = '{teman['sub']}'") \
        == [("t", "t")]
    # voucher bonus bisa dicek & dipakai kasir
    kasir = db.user("kasir2@x.id", peran="kasir")
    assert j(db, f"select kk_check_voucher('{r['ajak']['code']}')", kasir)["item"].startswith("Es teh gratis")


def test_ajak_lewat_klaim_lama_sama(db):
    db.sql("insert into kk_receipts(nota, total) values ('ESB-1', 30000)")
    pengajak, teman = db.member("6281200000001"), db.member("6281200000002")
    pasang_ajak(db, teman, pengajak)
    r = j(db, "select kk_claim('ESB-1', 30000)", teman)
    assert r["status"] == "ok" and r["ajak"] is not None
    assert (bonus(db, teman), bonus(db, pengajak)) == ("1", "1")


def test_ajak_tidak_untuk_staf_sendiri(db):
    siapkan(db, kasir_phone="6281200000002")
    pengajak, teman = db.member("6281200000001"), db.member("6281200000002")
    pasang_ajak(db, teman, pengajak)
    assert j(db, f"select kk_claim_code('{KODE}')", teman)["status"] == "staff_own"
    assert (bonus(db, teman), bonus(db, pengajak)) == ("0", "0")


def test_kode_ajak_terkunci_setelah_belanja(db):
    siapkan(db)
    pengajak, teman = db.member("6281200000001"), db.member("6281200000002")
    db.sql(f"select kk_claim_code('{KODE}')", sebagai=teman)
    kode = db.sql(f"select ref_code from kk_members where user_id = '{pengajak['sub']}'")[0][0]
    with pytest.raises(SqlError, match="sebelum belanja pertama"):
        db.sql(f"select kk_use_ref('{kode}')", sebagai=teman)


# ---------- bonus posting ----------
def test_bonus_posting_butuh_belanja_hari_ini_yang_tidak_void(db):
    kasir = siapkan(db)
    m = db.member("6281200000001")
    with pytest.raises(SqlError, match="belum punya nota belanja"):
        db.sql("select kk_posting_bonus('6281200000001', 'esteh', '')", sebagai=kasir)
    db.sql(f"select kk_claim_code('{KODE}')", sebagai=m)
    db.sql("update kk_receipts set voided_at = now()")
    assert j(db, "select kk_posting_status('6281200000001')", kasir)["belanja"] == 0
    with pytest.raises(SqlError, match="belum punya nota belanja"):
        db.sql("select kk_posting_bonus('6281200000001', 'esteh', '')", sebagai=kasir)
    db.sql("update kk_receipts set voided_at = null")
    r = j(db, "select kk_posting_bonus('6281200000001', 'esteh', 'https://instagram.com/p/x')", kasir)
    assert r["code"].startswith("TK-")
    with pytest.raises(SqlError, match="sudah klaim bonus posting"):
        db.sql("select kk_posting_bonus('6281200000001', 'tarik', '')", sebagai=kasir)


def test_bonus_posting_bukan_untuk_nomor_staf_sendiri(db):
    kasir = siapkan(db)
    db.sql(f"update kk_staff set phone = '6281200000001' where user_id = '{kasir['sub']}'")
    m = db.member("6281200000001")
    db.sql("insert into kk_receipts(nota, total) values ('ESB-1', 30000)")
    db.sql("select kk_claim('ESB-1', 30000)", sebagai=m)
    with pytest.raises(SqlError, match="nomor sendiri"):
        db.sql("select kk_posting_bonus('6281200000001', 'esteh', '')", sebagai=kasir)
    assert db.sql("select count(*) from kk_posts") == [("0",)]


def test_tarikan_bonus_satu_kartu_lewat_kk__pulls(db):
    kasir = siapkan(db)
    m = db.member("6281200000001")
    db.sql(f"select kk_claim_code('{KODE}')", sebagai=m)
    db.sql("select kk_posting_bonus('6281200000001', 'tarik', '')", sebagai=kasir)
    sebelum = int(db.sql("select pity_sr from kk_members")[0][0])
    r = j(db, "select kk_pull_bonus()", m)
    assert r["pulls"] == 1 and len(r["cards"]) == 1
    assert db.sql("select bonus_pulls from kk_members") == [("0",)]
    assert db.sql("select count(*) from kk_pulls where nota = 'BONUS-POSTING'") == [("1",)]
    sesudah = int(db.sql("select pity_sr from kk_members")[0][0])
    assert sesudah in (sebelum + 1, 0)
    with pytest.raises(SqlError, match="Tidak ada tarikan bonus"):
        db.sql("select kk_pull_bonus()", sebagai=m)


# ---------- Kasir Koi ----------
@pytest.fixture
def toko(db):
    return Toko(db)


def test_voucher_bonus_dipakai_di_kasir(db, toko):
    m = db.member("6281200000001")
    kode = db.sql(f"select kk__give_bonus('{m['sub']}', 'Es teh gratis · uji')")[0][0]
    r = toko.checkout(toko.payload(voucher_code=kode, total=15000, cash_received=20000))
    assert r["id"]
    assert db.sql("select used_at is not null from kk_exchanges") == [("t",)]


def test_void_nota_kecil_menurunkan_hitungan_member(db, toko):
    """kk__draw menaikkan trx/spent juga untuk nota too_small; void harus menurunkannya lagi."""
    n = toko.checkout(toko.payload(lines=[{"variant_id": toko.vid, "qty": 1}], total=15000, cash_received=20000))
    m = db.member("6281200000001")
    assert db.sql("select kk_claim_code('ABCDE-23456')->>'status'", sebagai=m) == [("too_small",)]
    assert db.sql("select trx, spent from kk_members") == [("1", "15000")]
    putuskan(db, toko, ajukan(db, toko, n["id"]), True)
    assert db.sql("select trx, spent from kk_members") == [("0", "0")]


# ---------- dijalankan di atas versi main ----------
def test_setup_aman_di_atas_versi_main(cluster):
    try:
        lama = subprocess.run(["git", "-C", str(AKAR), "show", "2bdc44e:kolam/setup.sql"],
                              capture_output=True, text=True, check=True).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        pytest.skip("riwayat git main 2bdc44e tidak tersedia")
    db = Db("main_" + __import__("uuid").uuid4().hex[:8])
    Db._buat(db.nama)
    Db._psql(db.nama, (AKAR / "_uji" / "supabase_tiruan.sql").read_text())
    Db._psql(db.nama, lama)
    m = db.member("6281200000001")  # member dari versi main (punya kode ajak lama)
    Db._psql(db.nama, (AKAR / "kolam" / "setup.sql").read_text())
    Db._psql(db.nama, (AKAR / "kasir" / "setup.sql").read_text())
    Db._psql(db.nama, (AKAR / "kolam" / "setup.sql").read_text())
    lama_nama = ",".join(f"'{n}'" for n in NAMA_LAMA)
    assert db.sql(f"select count(*) from pg_proc where pronamespace = 'public'::regnamespace "
                  f"and proname in ({lama_nama})") == [("0",)]
    assert db.sql("select string_agg(p.proname, ',' order by p.proname) from pg_proc p "
                  "where p.pronamespace = 'public'::regnamespace and p.proname like 'kk%' "
                  "and has_function_privilege('anon', p.oid, 'execute')") == [("kk_board,kk_ref_check",)]
    assert db.sql("select has_table_privilege('authenticated', 'public.kk_receipts', 'select')") == [("f",)]
    assert db.sql("select ref_code is not null from kk_members") == [("t",)]
    assert j(db, "select kk_me()", m)["ref_code"]
    kasir = aal2(db.user("pemilik@x.id", peran="pemilik"))
    assert j(db, "select kk_admin_summary()", kasir)["mfa"] is True
