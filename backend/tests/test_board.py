import json
import sqlite3

import pytest
from conftest import login, register
from fastapi.testclient import TestClient

from app import db
from app.board import DEFAULT_BOARD, EMPTY_BOARD
from app.main import app


def default_board() -> dict:
    return DEFAULT_BOARD.model_dump()


def put(client, board_id: int, board: dict, version: int):
    return client.put(f"/api/boards/{board_id}", json={"version": version, "board": board})


def test_init_db_creates_file_and_tables(db_path):
    assert not db_path.exists()
    db.init_db()
    assert db_path.exists()
    with sqlite3.connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"users", "boards"} <= tables


def make_old_database(db_path, with_version: bool):
    """A database from before multiple boards: one board per user, no name (and maybe no version)."""
    version = "version INTEGER NOT NULL DEFAULT 1," if with_version else ""
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            f"""
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE boards (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                data TEXT NOT NULL, {version} updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO users (username) VALUES ('user');
            """
        )
        conn.execute("INSERT INTO boards (user_id, data) VALUES (1, ?)", (DEFAULT_BOARD.model_dump_json(),))
        if with_version:
            conn.execute("UPDATE boards SET version = 7")
    conn.close()


def test_init_db_upgrades_a_database_without_versions(db_path):
    make_old_database(db_path, with_version=False)
    db.init_db()
    [row] = db.list_boards(1)
    assert (row.id, row.name, row.data, row.version) == (1, "My board", DEFAULT_BOARD.model_dump_json(), 1)


def test_init_db_upgrades_a_one_board_per_user_database(db_path):
    make_old_database(db_path, with_version=True)
    db.init_db()
    assert db.list_boards(1)[0].version == 7
    db.create_board(1, "Second", EMPTY_BOARD.model_dump_json())  # the one-board limit is gone
    assert [row.name for row in db.list_boards(1)] == ["My board", "Second"]


def test_upgraded_database_keeps_the_board_for_the_demo_user(db_path):
    make_old_database(db_path, with_version=True)
    with TestClient(app) as client:
        login(client)
        [summary] = client.get("/api/boards").json()
        assert summary["name"] == "My board"
        body = client.get(f"/api/boards/{summary['id']}").json()
    assert body["version"] == 7
    assert body["board"] == default_board()


def test_startup_seeds_the_demo_user_with_a_first_board(client, db_path):
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT username FROM users").fetchall() == [("user",)]
        assert conn.execute("SELECT name FROM boards").fetchall() == [("My first board",)]


def test_board_routes_require_login(client):
    assert client.get("/api/boards").status_code == 401
    assert client.post("/api/boards", json={"name": "x"}).status_code == 401
    assert client.get("/api/boards/1").status_code == 401
    assert put(client, 1, default_board(), 1).status_code == 401
    assert client.patch("/api/boards/1", json={"name": "x"}).status_code == 401
    assert client.delete("/api/boards/1").status_code == 401


def test_list_boards(signed_in, board_id):
    [summary] = signed_in.get("/api/boards").json()
    assert summary["id"] == board_id
    assert summary["name"] == "My first board"
    assert summary["updated_at"]


def test_get_board_returns_the_sample_board_at_version_1(signed_in, board_id):
    response = signed_in.get(f"/api/boards/{board_id}")
    assert response.status_code == 200
    assert response.json() == {
        "id": board_id, "name": "My first board", "owner": "user", "version": 1, "board": default_board()
    }


def test_create_board_has_the_standard_columns_and_no_cards(signed_in, board_id):
    response = signed_in.post("/api/boards", json={"name": "  Launch plan  "})
    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Launch plan"
    assert created["version"] == 1
    assert created["board"] == EMPTY_BOARD.model_dump()
    assert [b["name"] for b in signed_in.get("/api/boards").json()] == ["My first board", "Launch plan"]
    assert signed_in.get(f"/api/boards/{created['id']}").json() == created


def test_board_name_is_required_and_limited(signed_in, board_id):
    assert signed_in.post("/api/boards", json={"name": "   "}).status_code == 422
    assert signed_in.post("/api/boards", json={"name": "x" * 101}).status_code == 422
    assert signed_in.patch(f"/api/boards/{board_id}", json={"name": ""}).status_code == 422


def test_rename_board(signed_in, board_id):
    response = signed_in.patch(f"/api/boards/{board_id}", json={"name": "Renamed"})
    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"
    body = signed_in.get(f"/api/boards/{board_id}").json()
    assert body["name"] == "Renamed"
    assert body["version"] == 1  # renaming does not touch the board contents


def test_delete_board(signed_in, board_id):
    other = signed_in.post("/api/boards", json={"name": "Other"}).json()
    assert signed_in.delete(f"/api/boards/{board_id}").status_code == 204
    assert [b["id"] for b in signed_in.get("/api/boards").json()] == [other["id"]]
    assert signed_in.get(f"/api/boards/{board_id}").status_code == 404
    assert signed_in.delete(f"/api/boards/{board_id}").status_code == 404


def test_a_user_can_delete_all_their_boards(signed_in, board_id):
    signed_in.delete(f"/api/boards/{board_id}")
    assert signed_in.get("/api/boards").json() == []


def test_unknown_board_is_404(signed_in, board_id):
    assert signed_in.get("/api/boards/999").status_code == 404
    assert put(signed_in, 999, default_board(), 1).status_code == 404
    assert signed_in.patch("/api/boards/999", json={"name": "x"}).status_code == 404


def test_other_users_boards_are_hidden(signed_in, board_id):
    with TestClient(app) as alice:
        register(alice)
        [alice_board] = alice.get("/api/boards").json()

        assert alice.get(f"/api/boards/{board_id}").status_code == 404
        assert put(alice, board_id, default_board(), 1).status_code == 404
        assert alice.patch(f"/api/boards/{board_id}", json={"name": "Mine"}).status_code == 404
        assert alice.delete(f"/api/boards/{board_id}").status_code == 404
        assert alice.post(f"/api/boards/{board_id}/chat", json={"message": "hi"}).status_code == 404

    assert signed_in.get(f"/api/boards/{alice_board['id']}").status_code == 404
    assert [b["id"] for b in signed_in.get("/api/boards").json()] == [board_id]
    assert signed_in.get(f"/api/boards/{board_id}").json()["name"] == "My first board"


def test_save_then_get_returns_saved_board_and_new_version(signed_in, board_id):
    board = default_board()
    board["columns"][0]["title"] = "Ideas"
    board["columns"][0]["cardIds"].remove("card-1")
    board["columns"][4]["cardIds"].append("card-1")
    board["cards"]["card-9"] = {
        "id": "card-9", "title": "New", "details": "", "priority": "high", "dueDate": "2026-12-01",
        "labels": ["launch"],
    }
    board["columns"][1]["cardIds"].insert(0, "card-9")

    response = put(signed_in, board_id, board, 1)
    assert response.status_code == 200
    assert response.json() == {"version": 2, "board": board}
    saved = signed_in.get(f"/api/boards/{board_id}").json()
    assert (saved["version"], saved["board"]) == (2, board)


def test_saving_one_board_leaves_the_others_alone(signed_in, board_id):
    other = signed_in.post("/api/boards", json={"name": "Other"}).json()
    board = default_board()
    board["cards"]["card-1"]["title"] = "Changed"
    assert put(signed_in, board_id, board, 1).status_code == 200
    assert signed_in.get(f"/api/boards/{other['id']}").json() == other


def test_stale_version_is_rejected_with_the_current_board(signed_in, board_id):
    first = default_board()
    first["cards"]["card-1"]["title"] = "First save"
    assert put(signed_in, board_id, first, 1).status_code == 200

    second = default_board()
    second["cards"]["card-2"]["title"] = "Based on the old version"
    response = put(signed_in, board_id, second, 1)
    assert response.status_code == 409
    body = response.json()
    assert body["version"] == 2
    assert body["board"] == first
    assert signed_in.get(f"/api/boards/{board_id}").json()["board"] == first


def test_board_persists_across_restart(signed_in, board_id):
    board = default_board()
    board["cards"]["card-1"]["title"] = "Changed"
    put(signed_in, board_id, board, 1)

    with TestClient(app) as client:
        login(client)
        body = client.get(f"/api/boards/{board_id}").json()
    assert (body["version"], body["board"]) == (2, board)


def test_invalid_board_json_rejected(signed_in, board_id):
    assert put(signed_in, board_id, {"columns": "nope"}, 1).status_code == 422
    assert signed_in.put(f"/api/boards/{board_id}", json=default_board()).status_code == 422

    board = default_board()
    board["cards"]["card-1"]["title"] = ""
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_card_missing_from_columns_rejected(signed_in, board_id):
    board = default_board()
    board["columns"][0]["cardIds"].remove("card-1")
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_card_in_two_columns_rejected(signed_in, board_id):
    board = default_board()
    board["columns"][1]["cardIds"].append("card-1")
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_unknown_card_id_rejected(signed_in, board_id):
    board = default_board()
    board["columns"][0]["cardIds"].append("card-404")
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_card_key_must_match_id(signed_in, board_id):
    board = default_board()
    board["cards"]["card-1"]["id"] = "card-x"
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_columns_can_be_added_renamed_reordered_and_removed(signed_in, board_id):
    board = default_board()
    board["columns"].reverse()
    board["columns"][0]["title"] = "Shipped"
    board["columns"].insert(2, {"id": "col-blocked", "title": "Blocked", "cardIds": []})
    board["columns"].append({"id": "col-ideas", "title": "Ideas", "cardIds": []})
    response = put(signed_in, board_id, board, 1)
    assert response.status_code == 200
    assert [c["title"] for c in response.json()["board"]["columns"]] == [
        "Shipped", "Review", "Blocked", "In Progress", "Discovery", "Backlog", "Ideas"
    ]

    board["columns"] = [c for c in board["columns"] if c["id"] not in ("col-blocked", "col-review")]
    del board["cards"]["card-6"]
    assert put(signed_in, board_id, board, 2).status_code == 200


def test_a_board_can_have_no_columns(signed_in, board_id):
    assert put(signed_in, board_id, {"columns": [], "cards": {}}, 1).status_code == 200


def test_removing_a_column_that_still_has_cards_is_rejected(signed_in, board_id):
    board = default_board()
    board["columns"].pop()  # card-7 and card-8 would be left without a column
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_duplicate_column_ids_rejected(signed_in, board_id):
    board = default_board()
    board["columns"].append({"id": "col-done", "title": "Done again", "cardIds": []})
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_a_column_id_cannot_be_a_card_id(signed_in, board_id):
    board = default_board()
    board["columns"].append({"id": "card-1", "title": "Confusing", "cardIds": []})
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_update_board_only_succeeds_at_the_expected_version():
    db.init_db()
    user_id = db.create_user("someone", "hash")
    board_id = db.create_board(user_id, "Board", DEFAULT_BOARD.model_dump_json())
    data = DEFAULT_BOARD.model_dump_json()
    assert db.update_board(user_id, board_id, data, 1) == 2
    assert db.update_board(user_id, board_id, data, 1) is None
    assert db.update_board(user_id, board_id, data, 2) == 3
    assert db.update_board(user_id + 1, board_id, data, 3) is None  # not the owner


def test_card_fields_are_optional_and_filled_with_defaults(signed_in, board_id):
    board = default_board()
    board["cards"]["card-1"] = {"id": "card-1", "title": "Only the basics", "details": ""}
    saved = put(signed_in, board_id, board, 1).json()["board"]["cards"]["card-1"]
    assert saved == {"id": "card-1", "title": "Only the basics", "details": "", "priority": None,
                     "dueDate": None, "labels": []}


def test_boards_saved_before_card_fields_existed_still_load(signed_in, board_id, db_path):
    old = default_board()
    for card in old["cards"].values():
        for field in ("priority", "dueDate", "labels"):
            del card[field]
    with sqlite3.connect(db_path) as conn:
        conn.execute("UPDATE boards SET data = ? WHERE id = ?", (json.dumps(old), board_id))
    conn.close()
    assert signed_in.get(f"/api/boards/{board_id}").json()["board"] == default_board()


@pytest.mark.parametrize(
    "change",
    [
        {"priority": "urgent"},
        {"dueDate": "tomorrow"},
        {"dueDate": "2026-02-30"},
        {"labels": [""]},
        {"labels": ["x" * 31]},
        {"labels": [f"label-{i}" for i in range(11)]},
    ],
    ids=["priority", "date-text", "date-invalid", "label-empty", "label-long", "too-many-labels"],
)
def test_invalid_card_fields_rejected(signed_in, board_id, change):
    board = default_board()
    board["cards"]["card-1"].update(change)
    assert put(signed_in, board_id, board, 1).status_code == 422


def test_labels_are_trimmed(signed_in, board_id):
    board = default_board()
    board["cards"]["card-1"]["labels"] = ["  design "]
    assert put(signed_in, board_id, board, 1).json()["board"]["cards"]["card-1"]["labels"] == ["design"]
