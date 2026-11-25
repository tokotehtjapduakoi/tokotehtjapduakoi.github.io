import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).parent))

from db import Db, henti_cluster, mulai_cluster  # noqa: E402


@pytest.fixture(scope="session")
def cluster():
    """Cluster Postgres sementara (initdb sebagai user postgres), dihentikan di akhir."""
    dir_ = mulai_cluster()
    Db.cluster = dir_
    try:
        yield dir_
    finally:
        henti_cluster(dir_)
        Db.cluster = None
        Db._templat = None


@pytest.fixture
def db(cluster):
    return Db.baru()
