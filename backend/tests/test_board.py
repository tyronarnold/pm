import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db
from app.board import DEFAULT_BOARD, Board
from app.main import app


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def signed_in(client):
    client.post("/api/login", json={"username": "user", "password": "password"})
    return client


def default_board() -> dict:
    return DEFAULT_BOARD.model_dump()


def put(client, board: dict, version: int):
    return client.put("/api/board", json={"version": version, "board": board})


def test_init_db_creates_file_and_tables(db_path):
    assert not db_path.exists()
    db.init_db()
    assert db_path.exists()
    with sqlite3.connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"users", "boards"} <= tables


def test_init_db_adds_version_to_an_older_database(db_path):
    with sqlite3.connect(db_path) as conn:
        conn.executescript(
            """
            CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            CREATE TABLE boards (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
                data TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
            INSERT INTO users (username) VALUES ('user');
            """
        )
        conn.execute("INSERT INTO boards (user_id, data) VALUES (1, ?)", (DEFAULT_BOARD.model_dump_json(),))
    conn.close()

    db.init_db()
    assert db.get_board("user") == (DEFAULT_BOARD.model_dump_json(), 1)


def test_startup_seeds_user(client, db_path):
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT username FROM users").fetchall() == [("user",)]


def test_board_routes_require_login(client):
    assert client.get("/api/board").status_code == 401
    assert put(client, default_board(), 1).status_code == 401


def test_first_get_returns_default_board_at_version_1(signed_in):
    response = signed_in.get("/api/board")
    assert response.status_code == 200
    assert response.json() == {"version": 1, "board": default_board()}
    assert db.get_board("user") is not None


def test_put_then_get_returns_saved_board_and_new_version(signed_in):
    signed_in.get("/api/board")
    board = default_board()
    board["columns"][0]["title"] = "Ideas"
    board["columns"][0]["cardIds"].remove("card-1")
    board["columns"][4]["cardIds"].append("card-1")
    board["cards"]["card-9"] = {"id": "card-9", "title": "New", "details": ""}
    board["columns"][1]["cardIds"].insert(0, "card-9")

    response = put(signed_in, board, 1)
    assert response.status_code == 200
    assert response.json() == {"version": 2, "board": board}
    assert signed_in.get("/api/board").json() == {"version": 2, "board": board}


def test_stale_version_is_rejected_with_the_current_board(signed_in):
    signed_in.get("/api/board")
    first = default_board()
    first["cards"]["card-1"]["title"] = "First save"
    assert put(signed_in, first, 1).status_code == 200

    second = default_board()
    second["cards"]["card-2"]["title"] = "Based on the old version"
    response = put(signed_in, second, 1)
    assert response.status_code == 409
    body = response.json()
    assert body["version"] == 2
    assert body["board"] == first
    assert signed_in.get("/api/board").json() == {"version": 2, "board": first}


def test_board_persists_across_restart(signed_in):
    signed_in.get("/api/board")
    board = default_board()
    board["cards"]["card-1"]["title"] = "Changed"
    put(signed_in, board, 1)

    with TestClient(app) as client:
        client.post("/api/login", json={"username": "user", "password": "password"})
        assert client.get("/api/board").json() == {"version": 2, "board": board}


def test_invalid_board_json_rejected(signed_in):
    assert put(signed_in, {"columns": "nope"}, 1).status_code == 422
    assert signed_in.put("/api/board", json=default_board()).status_code == 422

    board = default_board()
    board["cards"]["card-1"]["title"] = ""
    assert put(signed_in, board, 1).status_code == 422


def test_card_missing_from_columns_rejected(signed_in):
    board = default_board()
    board["columns"][0]["cardIds"].remove("card-1")
    assert put(signed_in, board, 1).status_code == 422


def test_card_in_two_columns_rejected(signed_in):
    board = default_board()
    board["columns"][1]["cardIds"].append("card-1")
    assert put(signed_in, board, 1).status_code == 422


def test_unknown_card_id_rejected(signed_in):
    board = default_board()
    board["columns"][0]["cardIds"].append("card-404")
    assert put(signed_in, board, 1).status_code == 422


def test_card_key_must_match_id(signed_in):
    board = default_board()
    board["cards"]["card-1"]["id"] = "card-x"
    assert put(signed_in, board, 1).status_code == 422


def test_changed_column_ids_rejected(signed_in):
    board = default_board()
    board["columns"][0]["id"] = "col-new"
    assert put(signed_in, board, 1).status_code == 422

    board = default_board()
    board["columns"].reverse()
    assert put(signed_in, board, 1).status_code == 422

    board = default_board()
    board["columns"].pop()
    board["cards"].pop("card-7")
    board["cards"].pop("card-8")
    assert put(signed_in, board, 1).status_code == 422


def test_users_have_separate_boards(signed_in):
    other = default_board()
    other["columns"][0]["title"] = "Other backlog"
    db.add_user("other")
    db.create_board("other", Board.model_validate(other).model_dump_json())

    assert signed_in.get("/api/board").json() == {"version": 1, "board": default_board()}
    data, version = db.get_board("other")
    assert Board.model_validate_json(data).model_dump() == other
    assert version == 1


def test_update_board_only_succeeds_at_the_expected_version():
    db.init_db()
    db.add_user("user")
    db.create_board("user", DEFAULT_BOARD.model_dump_json())
    assert db.update_board("user", DEFAULT_BOARD.model_dump_json(), 1) == 2
    assert db.update_board("user", DEFAULT_BOARD.model_dump_json(), 1) is None
    assert db.update_board("user", DEFAULT_BOARD.model_dump_json(), 2) == 3
