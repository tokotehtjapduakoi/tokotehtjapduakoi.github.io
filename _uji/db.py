"""Harness uji: database Postgres sementara yang meniru Supabase (lihat README.md)."""
import json
import pathlib
import subprocess
import uuid

PG_BIN = "/usr/lib/postgresql/16/bin"
PORT = 54329
FS, RS, NUL = "\x1f", "\x1e", "\x1b<NULL>\x1b"  # pemisah kolom, pemisah baris, penanda NULL
AKAR = pathlib.Path(__file__).resolve().parent.parent


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

    def user(self, email: str, *, peran: str | None = None, phone: str | None = None) -> dict:
        meta = json.dumps({"phone": phone} if phone else {})
        (baris,) = self.sql(
            f"insert into auth.users(email, raw_user_meta_data) "
            f"values ($e${email}$e$, $m${meta}$m$::jsonb) returning id")
        uid = baris[0]
        if peran:
            self.sql(f"insert into kk_staff(user_id, role, name) values ('{uid}', $p${peran}$p$, $n${email}$n$)")
        return {"sub": uid, "role": "authenticated", "aal": "aal1", "email": email}

    def member(self, phone: str) -> dict:
        return self.user(f"{phone}@member.tjapduakoi.id", phone=phone)
