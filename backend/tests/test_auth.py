import sqlite3

from conftest import login
from fastapi.testclient import TestClient

from app import auth, db
from app.main import app


def demo_hash() -> str:
    return db.find_user("user")[1]


def test_login_success_sets_session_cookie(client):
    response = login(client)
    assert response.status_code == 200
    assert response.json() == {"username": "user"}
    assert "session" in response.cookies


def test_login_wrong_password(client):
    response = login(client, password="wrong")
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password."}
    assert "session" not in response.cookies


def test_login_wrong_username(client):
    response = login(client, username="admin")
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password."}


def test_me_requires_login(client):
    assert client.get("/api/me").status_code == 401
    login(client)
    response = client.get("/api/me")
    assert response.status_code == 200
    assert response.json() == {"username": "user"}


def test_logout_clears_session(client):
    login(client)
    assert client.post("/api/logout").status_code == 200
    assert client.get("/api/me").status_code == 401


def test_password_is_stored_as_an_argon2_hash(client):
    stored = demo_hash()
    assert stored.startswith("$argon2id$")
    assert "password" not in stored
    assert auth.verify_password(stored, "password")
    assert not auth.verify_password(stored, "Password")


def test_unknown_user_is_rejected_by_verify_password():
    assert not auth.verify_password(None, "password")


def test_startup_adds_a_password_to_an_older_database(db_path):
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,"
            " created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        conn.execute("INSERT INTO users (username) VALUES ('user')")
    conn.close()

    with TestClient(app) as client:
        assert login(client).status_code == 200
    assert demo_hash().startswith("$argon2id$")


def test_startup_keeps_an_existing_password(client):
    db.ensure_password("user", auth.hash_password("changed"))  # does not replace the existing hash
    assert login(client).status_code == 200
    with TestClient(app) as restarted:
        assert login(restarted).status_code == 200


def test_login_is_locked_after_too_many_failures(client, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(auth, "now", lambda: clock[0])

    for _ in range(auth.MAX_FAILED_LOGINS):
        assert login(client, password="wrong").status_code == 401

    locked = login(client)  # even the right password is refused while locked
    assert locked.status_code == 429
    assert "Too many failed sign-in attempts" in locked.json()["detail"]

    clock[0] += auth.LOCKOUT_SECONDS + 1
    assert login(client).status_code == 200


def test_successful_login_resets_the_failure_count(client):
    for _ in range(auth.MAX_FAILED_LOGINS - 1):
        login(client, password="wrong")
    assert login(client).status_code == 200
    for _ in range(auth.MAX_FAILED_LOGINS - 1):
        assert login(client, password="wrong").status_code == 401
    assert login(client).status_code == 200


def test_lockout_is_per_username(client):
    for _ in range(auth.MAX_FAILED_LOGINS):
        login(client, username="attacker-target", password="wrong")
    assert login(client, username="attacker-target").status_code == 429
    assert login(client).status_code == 200


def test_session_secret_comes_from_the_environment(monkeypatch):
    monkeypatch.setenv("SESSION_SECRET", "from-env")
    assert auth.session_secret() == "from-env"
    monkeypatch.delenv("SESSION_SECRET")
    assert len(auth.session_secret()) == 64  # random fallback


def test_https_only_is_opt_in(monkeypatch):
    monkeypatch.delenv("SESSION_HTTPS_ONLY", raising=False)
    assert auth.https_only() is False
    monkeypatch.setenv("SESSION_HTTPS_ONLY", "true")
    assert auth.https_only() is True
