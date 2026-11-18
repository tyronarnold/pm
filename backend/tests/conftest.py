import pytest

from app import auth


@pytest.fixture(autouse=True)
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(path))
    return path


@pytest.fixture(autouse=True)
def reset_login_limits():
    # The rate limiter keeps failed logins in memory; start every test with none.
    auth.failed_logins.clear()
