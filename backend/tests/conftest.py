from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import ai, auth
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


class FakeClient:
    """Stands in for the OpenAI client: records each request and returns a fixed result."""

    def __init__(self, result: ai.ChatResult | None, while_thinking=None, error=None, text="4"):
        self.requests = []
        self.result = result
        self.while_thinking = while_thinking
        self.error = error
        self.text = text
        self.chat = SimpleNamespace(completions=SimpleNamespace(parse=self.parse, create=self.create))

    def parse(self, **kwargs):
        self.requests.append(kwargs)
        if self.while_thinking:
            self.while_thinking()
        if self.error:
            raise self.error
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=self.result))])

    def create(self, **kwargs):
        """A plain chat completion (`ai.ask`)."""
        self.requests.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.text))])


@pytest.fixture
def fake_ai(monkeypatch):
    """Replaces the AI client; returns the fake so tests can read the requests it got."""

    def install(reply="Done.", operations=(), while_thinking=None, error=None, refuse=False):
        result = None if refuse else ai.ChatResult(reply=reply, operations=list(operations))
        fake = FakeClient(result, while_thinking, error)
        monkeypatch.setattr(ai, "client", lambda: fake)
        return fake

    return install
