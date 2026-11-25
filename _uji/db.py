"""Harness uji: database Postgres sementara yang meniru Supabase (lihat README.md)."""
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import uuid

PG_BIN = "/usr/lib/postgresql/16/bin"
PORT = 54329
FS, RS, NUL = "\x1f", "\x1e", "\x1b<NULL>\x1b"  # pemisah kolom, pemisah baris, penanda NULL
AKAR = pathlib.Path(__file__).resolve().parent.parent


def _postgres(perintah: str):
    return subprocess.run(["su", "postgres", "-c", perintah], capture_output=True, text=True)


def mulai_cluster() -> str:
    """Cluster Postgres sementara (initdb sebagai user postgres, hanya soket Unix). Kembalikan direktorinya."""
    dir_ = tempfile.mkdtemp(prefix="kasir-uji-")
    os.chmod(dir_, 0o755)
    shutil.chown(dir_, user="postgres")
    data = os.path.join(dir_, "data")
    r = _postgres(f"{PG_BIN}/initdb -D {data} -U postgres -A trust")
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    r = _postgres(f"{PG_BIN}/pg_ctl -D {data} -w -o '-p {PORT} -k {dir_} -c listen_addresses=' "
                  f"-l {dir_}/log start")
    if r.returncode != 0:
        raise RuntimeError(r.stdout + r.stderr)
    return dir_


def henti_cluster(dir_: str):
    _postgres(f"{PG_BIN}/pg_ctl -D {os.path.join(dir_, 'data')} -m immediate stop")
    shutil.rmtree(dir_, ignore_errors=True)


class SqlError(Exception):
    """Eksepsi SQL; str(e) berisi teks pesan Postgres."""


def aal2(klaim: dict) -> dict:
    return {**klaim, "aal": "aal2"}


class Db:
    cluster = None  # direktori cluster sementara; diisi fixture `cluster`
    _templat = None

    def __init__(self, nama: str):
        self.nama = nama

    # ---- psql ----
    @classmethod
    def _psql(cls, nama_db: str, stdin: str):
        r = subprocess.run(
            [f"{PG_BIN}/psql", "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-F", FS, "-R", RS,
             "-P", f"null={NUL}",
             "-h", cls.cluster, "-p", str(PORT), "-U", "postgres", "-d", nama_db, "-f", "-"],
            input=stdin, capture_output=True, text=True)
        if r.returncode != 0:
            pesan = r.stderr.strip()
            for baris in pesan.splitlines():
                if "ERROR:" in baris:
                    pesan = baris.split("ERROR:", 1)[1].strip()
                    break
            raise SqlError(pesan)
        return r.stdout

    @classmethod
    def _buat(cls, nama: str, templat: str | None = None):
        sql = f'create database "{nama}"' + (f' template "{templat}"' if templat else "")
        cls._psql("postgres", sql + ";")

    @classmethod
    def _templat_siap(cls) -> str:
        """Database templat berisi tiruan + kolam (+ kasir bila ada); dibuat sekali per cluster."""
        if cls._templat is None:
            nama = "templat_" + uuid.uuid4().hex[:8]
            cls._buat(nama)
            for f in (AKAR / "_uji" / "supabase_tiruan.sql", AKAR / "kolam" / "setup.sql",
                      AKAR / "kasir" / "setup.sql"):
                if f.exists():
                    cls._psql(nama, f.read_text())
            cls._templat = nama
        return cls._templat

    @classmethod
    def baru(cls) -> "Db":
        assert cls.cluster, "cluster belum jalan (pakai fixture `cluster`)"
        nama = "uji_" + uuid.uuid4().hex[:10]
        cls._buat(nama, cls._templat_siap())
        return cls(nama)

    # ---- API uji ----
    def sql(self, q: str, *, sebagai: dict | None = None) -> list[tuple]:
        """Batasan: hasil satu baris satu kolom berisi string kosong terbaca sebagai [] (psql tak membedakan)."""
        awal = ""
        if sebagai is not None:
            peran = sebagai.get("role", "authenticated")
            if peran not in ("anon", "authenticated"):
                raise ValueError(f"role tidak didukung: {peran!r}")
            awal = (f"set role {peran};\n"
                    f"do $kk$ begin perform set_config('request.jwt.claims', "
                    f"$j${json.dumps(sebagai)}$j$, false); end $kk$;\n")
        out = self._psql(self.nama, awal + q)
        out = out.removesuffix("\n")  # psql menambah satu newline di akhir
        if not out:
            return []
        if out.endswith(RS):
            out = out[:-len(RS)]
        return [tuple(None if k == NUL else k for k in b.split(FS)) for b in out.split(RS)]

    def user(self, email: str, *, peran: str | None = None, phone: str | None = None,
             sandi: str | None = None) -> dict:
        meta = json.dumps({"phone": phone} if phone else {})
        hash_ = f"extensions.crypt($s${sandi}$s$, extensions.gen_salt('bf'))" if sandi else "null"
        (baris,) = self.sql(
            f"insert into auth.users(email, raw_user_meta_data, encrypted_password) "
            f"values ($e${email}$e$, $m${meta}$m$::jsonb, {hash_}) returning id")
        uid = baris[0]
        if peran:
            self.sql(f"insert into kk_staff(user_id, role, name) values ('{uid}', $p${peran}$p$, $n${email}$n$)")
        return {"sub": uid, "role": "authenticated", "aal": "aal1", "email": email}

    def member(self, phone: str) -> dict:
        return self.user(f"{phone}@member.tjapduakoi.id", phone=phone)


# ---- CLI untuk uji e2e (_uji/e2e/bantu.mjs) ----
def isi_contoh(db: Db):
    """Data contoh e2e: pemilik, dua kasir, satu akun bukan staf, menu, metode bayar bawaan (dari setup)."""
    for email, peran, nama in (("pemilik@uji.id", "pemilik", "Pemilik"), ("ocha@uji.id", "kasir", "Ocha"),
                               ("budi@uji.id", "kasir", "Budi"), ("tamu@uji.id", None, None)):
        u = db.user(email, sandi="rahasia1")
        if peran:
            db.sql(f"insert into kk_staff(user_id, role, name) values ('{u['sub']}', '{peran}', '{nama}')")
    db.sql("""
      with t as (insert into pos_items(name, category, sort) values ('Teh Tarik', 'Minuman', 1) returning id)
      insert into pos_variants(item_id, name, price) select id, v.n, v.p from t, (values ('14 oz', 15000), ('22 oz', 22000)) v(n, p);
      with m as (insert into pos_items(name, category, sort) values ('Milo Tarik', 'Minuman', 2) returning id)
      insert into pos_variants(item_id, name, price) select id, '14 oz', 18000 from m;
      insert into pos_price_history(variant_id, price) select id, price from pos_variants;""")


def _buat():
    """Cluster + database baru berisi tiruan, kolam, kasir, dan data contoh.

    Mencetak satu baris JSON {"conninfo": ...} lalu menunggu sampai stdin ditutup atau
    proses dihentikan (SIGTERM/SIGINT); saat itu cluster dihentikan dan dihapus."""
    Db.cluster = mulai_cluster()
    selesai = False

    def tutup(*_):
        nonlocal selesai
        if not selesai:
            selesai = True
            henti_cluster(Db.cluster)
        sys.exit(0)

    signal.signal(signal.SIGTERM, tutup)
    signal.signal(signal.SIGINT, tutup)
    try:
        db = Db.baru()
        isi_contoh(db)
        print(json.dumps({"conninfo": f"postgresql://postgres@localhost/{db.nama}?host={Db.cluster}&port={PORT}"}),
              flush=True)
        sys.stdin.read()
    finally:
        tutup()


if __name__ == "__main__":
    if sys.argv[1:] == ["--buat"]:
        _buat()
    else:
        sys.exit("pakai: python3 db.py --buat")
