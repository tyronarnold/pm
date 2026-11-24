import sqlite3
from contextlib import closing

import pytest
from conftest import login, register
from fastapi.testclient import TestClient

from app import db
from app.board import DEFAULT_BOARD
from app.main import app


@pytest.fixture
def alice():
    """A second session, signed in as a new user called alice."""
    with TestClient(app) as client:
        register(client)
        yield client


def share(client, board_id: int, username: str):
    return client.post(f"/api/boards/{board_id}/members", json={"username": username})


def members(client, board_id: int):
    return client.get(f"/api/boards/{board_id}/members")


def test_owner_shares_a_board(signed_in, board_id, alice):
    response = share(signed_in, board_id, "alice")
    assert response.status_code == 201
    assert response.json() == ["alice"]
    assert members(signed_in, board_id).json() == ["alice"]


def test_a_shared_board_is_listed_for_the_member_with_its_owner(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    listed = [(b["name"], b["owner"]) for b in alice.get("/api/boards").json()]
    assert listed == [("My first board", "user"), ("My first board", "alice")]  # oldest first
    assert [b["owner"] for b in signed_in.get("/api/boards").json()] == ["user"]


def test_a_member_can_read_save_and_chat_on_the_board(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    shared = alice.get(f"/api/boards/{board_id}").json()
    assert shared["owner"] == "user"
    assert shared["board"] == DEFAULT_BOARD.model_dump()
    assert alice.get(f"/api/boards/{board_id}/members").json() == ["alice"]

    board = shared["board"]
    board["cards"]["card-1"]["title"] = "Edited by alice"
    response = alice.put(f"/api/boards/{board_id}", json={"version": 1, "board": board})
    assert response.status_code == 200
    assert signed_in.get(f"/api/boards/{board_id}").json()["board"]["cards"]["card-1"]["title"] == "Edited by alice"


def test_owner_and_member_saves_use_the_same_versions(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    board = DEFAULT_BOARD.model_dump()
    assert alice.put(f"/api/boards/{board_id}", json={"version": 1, "board": board}).status_code == 200
    stale = signed_in.put(f"/api/boards/{board_id}", json={"version": 1, "board": board})
    assert stale.status_code == 409
    assert stale.json()["version"] == 2


def test_only_the_owner_renames_deletes_and_shares(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    with TestClient(app) as bob:
        register(bob, "bob", "bob-password")

    for response in (
        alice.patch(f"/api/boards/{board_id}", json={"name": "Mine now"}),
        alice.delete(f"/api/boards/{board_id}"),
        share(alice, board_id, "bob"),
        alice.delete(f"/api/boards/{board_id}/members/bob"),
    ):
        assert response.status_code == 403
        assert response.json() == {"detail": "Only the board's owner can do that."}
    assert signed_in.get(f"/api/boards/{board_id}").json()["name"] == "My first board"


def test_boards_not_shared_with_you_stay_hidden(signed_in, board_id, alice):
    assert alice.get(f"/api/boards/{board_id}").status_code == 404
    assert members(alice, board_id).status_code == 404
    assert share(alice, board_id, "alice").status_code == 404
    assert alice.delete(f"/api/boards/{board_id}/members/alice").status_code == 404


def test_sharing_with_an_unknown_user_is_rejected(signed_in, board_id):
    response = share(signed_in, board_id, "nobody")
    assert response.status_code == 422
    assert response.json() == {"detail": 'There is no user called "nobody".'}


def test_usernames_are_trimmed_and_lowercased_when_sharing(signed_in, board_id, alice):
    assert share(signed_in, board_id, "  Alice ").json() == ["alice"]


def test_sharing_twice_or_with_yourself_is_rejected(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    again = share(signed_in, board_id, "alice")
    assert again.status_code == 409
    assert again.json() == {"detail": "alice is already a member."}
    yourself = share(signed_in, board_id, "user")
    assert yourself.status_code == 409
    assert yourself.json() == {"detail": "You own this board already."}


def test_owner_removes_a_member(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    assert signed_in.delete(f"/api/boards/{board_id}/members/alice").status_code == 204
    assert members(signed_in, board_id).json() == []
    assert alice.get(f"/api/boards/{board_id}").status_code == 404
    assert signed_in.delete(f"/api/boards/{board_id}/members/alice").status_code == 404


def test_a_member_leaves_a_board(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    assert alice.delete(f"/api/boards/{board_id}/members/alice").status_code == 204
    assert [b["owner"] for b in alice.get("/api/boards").json()] == ["alice"]
    assert alice.get(f"/api/boards/{board_id}").status_code == 404


def test_members_are_listed_in_the_order_they_were_added(signed_in, board_id, alice):
    with TestClient(app) as other:
        register(other, "zed", "zed-password")
    share(signed_in, board_id, "zed")
    share(signed_in, board_id, "alice")
    assert members(signed_in, board_id).json() == ["zed", "alice"]


def test_deleting_the_board_removes_the_memberships(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    signed_in.delete(f"/api/boards/{board_id}")
    assert [b["owner"] for b in alice.get("/api/boards").json()] == ["alice"]
    assert db.list_members(board_id) == []


def test_deleting_a_member_account_removes_the_membership(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    alice.request("DELETE", "/api/me", json={"password": "alice-password"})
    assert members(signed_in, board_id).json() == []


def test_deleting_the_owner_account_deletes_shared_boards(client):
    register(client, "owner", "owner-password")
    [board] = client.get("/api/boards").json()
    with TestClient(app) as member:
        register(member, "member", "member-password")
        share(client, board["id"], "member")
        assert len(member.get("/api/boards").json()) == 2
        client.request("DELETE", "/api/me", json={"password": "owner-password"})
        assert [b["owner"] for b in member.get("/api/boards").json()] == ["member"]


def test_init_db_adds_the_members_table_to_an_older_database(db_path):
    with closing(sqlite3.connect(db_path, autocommit=True)) as conn:
        conn.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT,
                session_version INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE boards (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            """
        )
    with TestClient(app) as client:
        login(client)
        assert client.get("/api/boards").status_code == 200
    with closing(sqlite3.connect(db_path, autocommit=True)) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "board_members" in tables


def test_board_details_list_the_members(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    assert signed_in.get(f"/api/boards/{board_id}").json()["members"] == ["alice"]
    assert alice.get(f"/api/boards/{board_id}").json()["members"] == ["alice"]


def test_assigned_cards_count_as_mine_for_each_user(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    board = DEFAULT_BOARD.model_dump()
    board["cards"]["card-1"]["assignee"] = "alice"
    board["cards"]["card-2"]["assignee"] = "alice"
    signed_in.put(f"/api/boards/{board_id}", json={"version": 1, "board": board})
    shared = next(b for b in alice.get("/api/boards").json() if b["id"] == board_id)
    assert shared["mine"] == 2
    assert signed_in.get("/api/boards").json()[0]["mine"] == 0


def test_a_removed_members_assignments_stay_and_the_board_still_saves(signed_in, board_id, alice):
    share(signed_in, board_id, "alice")
    board = DEFAULT_BOARD.model_dump()
    board["cards"]["card-1"]["assignee"] = "alice"
    signed_in.put(f"/api/boards/{board_id}", json={"version": 1, "board": board})
    signed_in.delete(f"/api/boards/{board_id}/members/alice")
    board["cards"]["card-2"]["title"] = "Still saves"
    response = signed_in.put(f"/api/boards/{board_id}", json={"version": 2, "board": board})
    assert response.status_code == 200
    assert response.json()["board"]["cards"]["card-1"]["assignee"] == "alice"
