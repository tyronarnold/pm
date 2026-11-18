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
    version INTEGER NOT NULL DEFAULT 1,
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
        # Databases created before boards had a version keep their data and start at version 1.
        columns = [row[1] for row in conn.execute("PRAGMA table_info(boards)")]
        if "version" not in columns:
            conn.execute("ALTER TABLE boards ADD COLUMN version INTEGER NOT NULL DEFAULT 1")


def add_user(username: str) -> None:
    with closing(connect()) as conn:
        conn.execute("INSERT OR IGNORE INTO users (username) VALUES (?)", (username,))


def get_board(username: str) -> tuple[str, int] | None:
    """Return the user's board JSON and its version, or None if they have no board yet."""
    with closing(connect()) as conn:
        return conn.execute(
            "SELECT boards.data, boards.version FROM boards JOIN users ON users.id = boards.user_id"
            " WHERE users.username = ?",
            (username,),
        ).fetchone()


def create_board(username: str, data: str) -> None:
    """Create the user's board at version 1 (does nothing if it already exists)."""
    with closing(connect()) as conn:
        conn.execute(
            "INSERT INTO boards (user_id, data) SELECT id, ? FROM users WHERE username = ?"
            " ON CONFLICT (user_id) DO NOTHING",
            (data, username),
        )


def update_board(username: str, data: str, version: int) -> int | None:
    """Save the board only if it is still at `version`.

    Returns the new version, or None if the board was changed by someone else
    in the meantime (or does not exist).
    """
    with closing(connect()) as conn:
        row = conn.execute(
            "UPDATE boards SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP"
            " WHERE user_id = (SELECT id FROM users WHERE username = ?) AND version = ?"
            " RETURNING version",
            (data, username, version),
        ).fetchone()
    return row[0] if row else None
