import pytest
from conftest import login, register
from fastapi.testclient import TestClient

from app import db
from app.board import DEFAULT_BOARD
from app.main import app


def test_register_creates_an_account_and_signs_in(client):
    response = register(client)
    assert response.status_code == 201
    assert response.json() == {"username": "alice", "is_admin": False}
    assert client.get("/api/me").json() == {"username": "alice", "is_admin": False}


def test_a_new_account_starts_with_the_sample_board(client):
    register(client)
    [summary] = client.get("/api/boards").json()
    assert summary["name"] == "My first board"
    assert client.get(f"/api/boards/{summary['id']}").json()["board"] == DEFAULT_BOARD.model_dump()


def test_a_new_account_can_sign_in_later(client):
    register(client)
    client.post("/api/logout")
    assert login(client, "alice", "alice-password").status_code == 200
    assert login(client, "alice", "wrong-password").status_code == 401


def test_username_must_be_unique(client):
    register(client)
    response = register(client, password="another-password")
    assert response.status_code == 409
    assert response.json() == {"detail": "That username is already taken."}
    assert register(client, username="user").status_code == 409


@pytest.mark.parametrize("username", ["ab", "x" * 33, "Alice", "has space", "semi;colon", ""])
def test_invalid_usernames_are_rejected(client, username):
    assert register(client, username=username).status_code == 422


@pytest.mark.parametrize("username", ["abc", "x" * 32, "jo.doe", "jo_doe", "jo-doe", "user2"])
def test_valid_usernames_are_accepted(client, username):
    assert register(client, username=username).status_code == 201


def test_password_needs_8_characters(client):
    assert register(client, password="1234567").status_code == 422
    assert register(client, password="12345678").status_code == 201


def test_registering_replaces_the_current_session(signed_in):
    register(signed_in)
    assert signed_in.get("/api/me").json() == {"username": "alice", "is_admin": False}


def test_change_password(signed_in):
    response = signed_in.put(
        "/api/me/password", json={"current_password": "password", "new_password": "new-password"}
    )
    assert response.status_code == 200
    signed_in.post("/api/logout")
    assert login(signed_in).status_code == 401
    assert login(signed_in, password="new-password").status_code == 200


def test_change_password_needs_the_current_password(signed_in):
    response = signed_in.put(
        "/api/me/password", json={"current_password": "wrong", "new_password": "new-password"}
    )
    assert response.status_code == 403
    assert response.json() == {"detail": "That password is not correct."}
    signed_in.post("/api/logout")
    assert login(signed_in).status_code == 200


def test_new_password_needs_8_characters(signed_in):
    response = signed_in.put("/api/me/password", json={"current_password": "password", "new_password": "short"})
    assert response.status_code == 422


def test_account_routes_require_login(client):
    assert client.put("/api/me/password", json={"current_password": "a", "new_password": "b" * 8}).status_code == 401
    assert client.request("DELETE", "/api/me", json={"password": "password"}).status_code == 401


def test_delete_account_removes_the_user_and_their_boards(client):
    register(client)
    client.post("/api/boards", json={"name": "Second"})
    user, _ = db.find_user("alice")
    assert len(db.list_boards(user.id)) == 2

    response = client.request("DELETE", "/api/me", json={"password": "alice-password"})
    assert response.status_code == 204
    assert client.get("/api/me").status_code == 401
    assert db.find_user("alice") is None
    assert db.list_boards(user.id) == []
    assert login(client, "alice", "alice-password").status_code == 401


def test_delete_account_needs_the_password(client):
    register(client)
    response = client.request("DELETE", "/api/me", json={"password": "wrong"})
    assert response.status_code == 403
    assert client.get("/api/me").json() == {"username": "alice", "is_admin": False}


def test_a_deleted_account_is_signed_out_in_every_session(client):
    register(client)
    with TestClient(app) as other_session:
        login(other_session, "alice", "alice-password")
        client.request("DELETE", "/api/me", json={"password": "alice-password"})
        assert other_session.get("/api/me").status_code == 401
        assert other_session.get("/api/boards").status_code == 401


def test_the_username_can_be_registered_again_after_deletion(client):
    register(client)
    client.request("DELETE", "/api/me", json={"password": "alice-password"})
    assert register(client, password="fresh-password").status_code == 201
    assert len(client.get("/api/boards").json()) == 1


def test_changing_the_password_signs_out_other_sessions_but_not_this_one(client):
    register(client)
    with TestClient(app) as other_session:
        login(other_session, "alice", "alice-password")
        client.put("/api/me/password", json={"current_password": "alice-password", "new_password": "new-password"})
        assert other_session.get("/api/me").status_code == 401
        assert client.get("/api/me").json() == {"username": "alice", "is_admin": False}
        assert login(other_session, "alice", "new-password").status_code == 200
        assert other_session.get("/api/me").status_code == 200

