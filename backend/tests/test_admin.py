import sqlite3

import pytest
from conftest import login, register
from fastapi.testclient import TestClient

from app import auth, db
from app.main import app


@pytest.fixture
def alice():
    """A second session, signed in as a new (non-admin) user called alice."""
    with TestClient(app) as client:
        register(client)
        yield client


def users(client):
    return client.get("/api/admin/users")


def set_role(client, username: str, is_admin: bool):
    return client.patch(f"/api/admin/users/{username}", json={"is_admin": is_admin})


def test_the_demo_account_is_the_first_admin(signed_in):
    assert signed_in.get("/api/me").json() == {"username": "user", "is_admin": True}


def test_new_accounts_are_not_admins(alice):
    assert alice.get("/api/me").json() == {"username": "alice", "is_admin": False}


def test_admins_list_every_user_with_their_board_counts(signed_in, alice):
    alice.post("/api/boards", json={"name": "Second"})
    listed = users(signed_in).json()
    assert [(u["username"], u["is_admin"], u["boards"]) for u in listed] == [("alice", False, 2), ("user", True, 1)]
    assert all(u["created_at"] for u in listed)


def test_admin_routes_are_for_admins_only(alice, signed_in):
    for response in (
        users(alice),
        set_role(alice, "alice", True),
        alice.put("/api/admin/users/user/password", json={"new_password": "taken-over"}),
        alice.delete("/api/admin/users/user"),
    ):
        assert response.status_code == 403
        assert response.json() == {"detail": "Only admins can do that."}
    assert login(signed_in).status_code == 200  # the password was not changed


def test_admin_routes_require_login(client):
    assert users(client).status_code == 401


def test_make_and_remove_an_admin(signed_in, alice):
    response = set_role(signed_in, "alice", True)
    assert response.status_code == 200
    assert response.json()["is_admin"] is True
    assert alice.get("/api/me").json()["is_admin"] is True
    assert users(alice).status_code == 200  # takes effect at once, no new sign-in needed

    assert set_role(signed_in, "alice", False).json()["is_admin"] is False
    assert users(alice).status_code == 403


def test_the_last_admin_cannot_be_removed(signed_in, alice):
    response = set_role(signed_in, "user", False)
    assert response.status_code == 409
    assert response.json() == {"detail": "There must be at least one admin."}

    set_role(signed_in, "alice", True)
    assert set_role(signed_in, "user", False).status_code == 200  # alice is still an admin
    assert set_role(alice, "alice", False).status_code == 409


def test_unknown_users_are_404(signed_in):
    assert set_role(signed_in, "nobody", True).status_code == 404
    assert signed_in.put("/api/admin/users/nobody/password", json={"new_password": "whatever1"}).status_code == 404
    assert signed_in.delete("/api/admin/users/nobody").status_code == 404


def test_reset_password_signs_the_user_out_and_lifts_a_lockout(signed_in, alice):
    for _ in range(auth.MAX_FAILED_LOGINS):
        login(signed_in, "alice", "wrong")
    response = signed_in.put("/api/admin/users/alice/password", json={"new_password": "reset-by-admin"})
    assert response.status_code == 200

    assert alice.get("/api/me").status_code == 401
    with TestClient(app) as fresh:
        assert login(fresh, "alice", "alice-password").status_code == 401
        assert login(fresh, "alice", "reset-by-admin").status_code == 200


def test_reset_password_needs_8_characters(signed_in, alice):
    assert signed_in.put("/api/admin/users/alice/password", json={"new_password": "short"}).status_code == 422


def test_an_admin_resetting_their_own_password_stays_signed_in(signed_in):
    signed_in.put("/api/admin/users/user/password", json={"new_password": "new-admin-password"})
    assert signed_in.get("/api/me").status_code == 200


def test_delete_a_user_and_their_boards(signed_in, alice):
    [alice_board] = alice.get("/api/boards").json()
    assert signed_in.delete("/api/admin/users/alice").status_code == 204
    assert [u["username"] for u in users(signed_in).json()] == ["user"]
    assert alice.get("/api/me").status_code == 401
    assert db.get_board(db.find_user("user")[0].id, alice_board["id"]) is None


def test_admins_delete_their_own_account_from_account_settings(signed_in):
    response = signed_in.delete("/api/admin/users/user")
    assert response.status_code == 409
    assert response.json() == {"detail": "Delete your own account from your account settings."}


def test_startup_makes_the_demo_account_admin_when_nobody_is(db_path):
    # A database from before admins existed.
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT,"
            " session_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)"
        )
        conn.execute("INSERT INTO users (username) VALUES ('user'), ('alice')")
    conn.close()
    with TestClient(app) as client:
        login(client)
        assert client.get("/api/me").json()["is_admin"] is True
    assert db.find_user("alice")[0].is_admin is False


def test_startup_leaves_admins_alone_when_there_is_one(signed_in, alice):
    set_role(signed_in, "alice", True)
    set_role(signed_in, "user", False)
    with TestClient(app) as restarted:
        login(restarted)
        assert restarted.get("/api/me").json()["is_admin"] is False
