import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from db import Db, PG_BIN, PORT  # noqa: E402


def _postgres(perintah: str):
    return subprocess.run(["su", "postgres", "-c", perintah], capture_output=True, text=True)


@pytest.fixture(scope="session")
def cluster():
    """Cluster Postgres sementara (initdb sebagai user postgres), dihentikan di akhir."""
    dir_ = tempfile.mkdtemp(prefix="kasir-uji-")
    os.chmod(dir_, 0o755)
    shutil.chown(dir_, user="postgres")
    data = os.path.join(dir_, "data")
    r = _postgres(f"{PG_BIN}/initdb -D {data} -U postgres -A trust")
    assert r.returncode == 0, r.stderr
    r = _postgres(f"{PG_BIN}/pg_ctl -D {data} -w -o '-p {PORT} -k {dir_} -c listen_addresses=' "
                  f"-l {dir_}/log start")
    assert r.returncode == 0, r.stdout + r.stderr
    Db.cluster = dir_
    try:
        yield dir_
    finally:
        _postgres(f"{PG_BIN}/pg_ctl -D {data} -m immediate stop")
        Db.cluster = None
        Db._templat = None
        shutil.rmtree(dir_, ignore_errors=True)


@pytest.fixture
def db(cluster):
    return Db.baru()
