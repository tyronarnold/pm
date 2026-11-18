import sqlite3

import pytest
from fastapi.testclient import TestClient

from app import db
from app.board import DEFAULT_BOARD
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


def test_init_db_creates_file_and_tables(db_path):
    assert not db_path.exists()
    db.init_db()
    assert db_path.exists()
    with sqlite3.connect(db_path) as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"users", "boards"} <= tables


def test_startup_seeds_user(client, db_path):
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("SELECT username FROM users").fetchall() == [("user",)]


def test_board_routes_require_login(client):
    assert client.get("/api/board").status_code == 401
    assert client.put("/api/board", json=default_board()).status_code == 401


def test_first_get_returns_default_board(signed_in):
    response = signed_in.get("/api/board")
    assert response.status_code == 200
    assert response.json() == default_board()
    assert db.get_board("user") is not None


def test_put_then_get_returns_saved_board(signed_in):
    board = default_board()
    board["columns"][0]["title"] = "Ideas"
    board["columns"][0]["cardIds"].remove("card-1")
    board["columns"][4]["cardIds"].append("card-1")
    board["cards"]["card-9"] = {"id": "card-9", "title": "New", "details": ""}
    board["columns"][1]["cardIds"].insert(0, "card-9")

    response = signed_in.put("/api/board", json=board)
    assert response.status_code == 200
    assert signed_in.get("/api/board").json() == board


def test_board_persists_across_restart(signed_in):
    board = default_board()
    board["cards"]["card-1"]["title"] = "Changed"
    signed_in.put("/api/board", json=board)

    with TestClient(app) as client:
        client.post("/api/login", json={"username": "user", "password": "password"})
        assert client.get("/api/board").json() == board


def test_invalid_board_json_rejected(signed_in):
    assert signed_in.put("/api/board", json={"columns": "nope"}).status_code == 422

    board = default_board()
    board["cards"]["card-1"]["title"] = ""
    assert signed_in.put("/api/board", json=board).status_code == 422


def test_card_missing_from_columns_rejected(signed_in):
    board = default_board()
    board["columns"][0]["cardIds"].remove("card-1")
    assert signed_in.put("/api/board", json=board).status_code == 422


def test_card_in_two_columns_rejected(signed_in):
    board = default_board()
    board["columns"][1]["cardIds"].append("card-1")
    assert signed_in.put("/api/board", json=board).status_code == 422


def test_unknown_card_id_rejected(signed_in):
    board = default_board()
    board["columns"][0]["cardIds"].append("card-404")
    assert signed_in.put("/api/board", json=board).status_code == 422


def test_card_key_must_match_id(signed_in):
    board = default_board()
    board["cards"]["card-1"]["id"] = "card-x"
    assert signed_in.put("/api/board", json=board).status_code == 422


def test_changed_column_ids_rejected(signed_in):
    board = default_board()
    board["columns"][0]["id"] = "col-new"
    assert signed_in.put("/api/board", json=board).status_code == 422

    board = default_board()
    board["columns"].reverse()
    assert signed_in.put("/api/board", json=board).status_code == 422

    board = default_board()
    board["columns"].pop()
    board["cards"].pop("card-7")
    board["cards"].pop("card-8")
    assert signed_in.put("/api/board", json=board).status_code == 422


def test_users_have_separate_boards(signed_in):
    other = default_board()
    other["columns"][0]["title"] = "Other backlog"
    db.add_user("other")
    db.save_board("other", DEFAULT_BOARD.model_validate(other).model_dump_json())

    assert signed_in.get("/api/board").json() == default_board()
    assert DEFAULT_BOARD.model_validate_json(db.get_board("other")).model_dump() == other
