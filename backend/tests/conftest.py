import pytest
from fastapi.testclient import TestClient

from app import auth
from app.main import app


@pytest.fixture(autouse=True)
def db_path(tmp_path, monkeypatch):
    path = tmp_path / "test.db"
    monkeypatch.setenv("DB_PATH", str(path))
    return path


@pytest.fixture(autouse=True)
def reset_login_limits():
    # The rate limiter keeps failed logins in memory; start every test with none.
    auth.failed_logins.clear()


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def login(client, username="user", password="password"):
    return client.post("/api/login", json={"username": username, "password": password})


def register(client, username="alice", password="alice-password"):
    return client.post("/api/register", json={"username": username, "password": password})


@pytest.fixture
def signed_in(client):
    """A client signed in as the demo user."""
    login(client)
    return client


@pytest.fixture
def board_id(signed_in) -> int:
    """The id of the demo user's first board (holding the sample cards)."""
    return signed_in.get("/api/boards").json()[0]["id"]
