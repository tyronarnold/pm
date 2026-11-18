import os
import sqlite3
from contextlib import closing
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


def connect() -> sqlite3.Connection:
    path = Path(os.environ.get("DB_PATH", "/app/data/pm.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, autocommit=True)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with closing(connect()) as conn:
        conn.executescript(SCHEMA)


def add_user(username: str) -> None:
    with closing(connect()) as conn:
        conn.execute("INSERT OR IGNORE INTO users (username) VALUES (?)", (username,))


def get_board(username: str) -> str | None:
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT boards.data FROM boards JOIN users ON users.id = boards.user_id"
            " WHERE users.username = ?",
            (username,),
        ).fetchone()
    return row[0] if row else None


def save_board(username: str, data: str) -> None:
    with closing(connect()) as conn:
        conn.execute(
            "INSERT INTO boards (user_id, data) SELECT id, ? FROM users WHERE username = ?"
            " ON CONFLICT (user_id) DO UPDATE"
            " SET data = excluded.data, updated_at = CURRENT_TIMESTAMP",
            (data, username),
        )
