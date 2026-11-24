import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import NamedTuple

USERS_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    session_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""

BOARDS_SCHEMA = """
CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS boards_user_id ON boards (user_id);
"""

# Databases from before multiple boards had one board per user (`user_id UNIQUE`) and no
# name. SQLite cannot drop a constraint, so the table is rebuilt, keeping every board.
MULTIPLE_BOARDS_MIGRATION = f"""
BEGIN;
ALTER TABLE boards RENAME TO boards_old;
{BOARDS_SCHEMA}
INSERT INTO boards (id, user_id, name, data, version, updated_at)
    SELECT id, user_id, 'My board', data, version, updated_at FROM boards_old;
DROP TABLE boards_old;
COMMIT;
"""


class User(NamedTuple):
    id: int
    username: str
    # Stored in the session cookie at sign-in; changing the password increments it,
    # which signs out every other session.
    session_version: int


class BoardRow(NamedTuple):
    id: int
    name: str
    data: str
    version: int
    updated_at: str


def connect() -> sqlite3.Connection:
    path = Path(os.environ.get("DB_PATH", "/app/data/pm.db"))
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, autocommit=True)
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _columns(conn: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]


def init_db() -> None:
    """Create the tables if missing, and upgrade databases made by earlier versions."""
    with closing(connect()) as conn:
        conn.executescript(USERS_SCHEMA)
        users = _columns(conn, "users")
        if "password_hash" not in users:
            conn.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        if "session_version" not in users:
            conn.execute("ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0")
        old_boards = _columns(conn, "boards")
        if old_boards and "name" not in old_boards:
            if "version" not in old_boards:
                conn.execute("ALTER TABLE boards ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
            conn.executescript(MULTIPLE_BOARDS_MIGRATION)
        conn.executescript(BOARDS_SCHEMA)


# Users


def create_user(username: str, password_hash: str) -> int | None:
    """Create a user and return their id, or None if the username is taken."""
    with closing(connect()) as conn:
        row = conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)"
            " ON CONFLICT (username) DO NOTHING RETURNING id",
            (username, password_hash),
        ).fetchone()
    return row[0] if row else None


def ensure_password(username: str, password_hash: str) -> None:
    """Give an existing user this password hash if they have none (users from before hashing)."""
    with closing(connect()) as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE username = ? AND password_hash IS NULL",
            (password_hash, username),
        )


def get_user(user_id: int) -> User | None:
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT id, username, session_version FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return User(*row) if row else None


def find_user(username: str) -> tuple[User, str | None] | None:
    """The user and their password hash, or None if there is no such user."""
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT id, username, session_version, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    return (User(*row[:3]), row[3]) if row else None


def get_password_hash(user_id: int) -> str | None:
    with closing(connect()) as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    return row[0] if row else None


def set_password_hash(user_id: int, password_hash: str) -> int:
    """Set a new password hash and return the user's new session version."""
    with closing(connect()) as conn:
        return conn.execute(
            "UPDATE users SET password_hash = ?, session_version = session_version + 1 WHERE id = ?"
            " RETURNING session_version",
            (password_hash, user_id),
        ).fetchone()[0]


def delete_user(user_id: int) -> None:
    """Delete the user and all their boards."""
    with closing(connect()) as conn:
        conn.execute("DELETE FROM users WHERE id = ?", (user_id,))


# Boards. Every query is limited to the boards of `user_id`, so a user can never
# read or change another user's board.


def list_boards(user_id: int) -> list[BoardRow]:
    """The user's boards, oldest first."""
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT id, name, data, version, updated_at FROM boards WHERE user_id = ? ORDER BY id",
            (user_id,),
        ).fetchall()
    return [BoardRow(*row) for row in rows]


def create_board(user_id: int, name: str, data: str) -> int:
    """Create a board at version 1 and return its id."""
    with closing(connect()) as conn:
        return conn.execute(
            "INSERT INTO boards (user_id, name, data) VALUES (?, ?, ?) RETURNING id",
            (user_id, name, data),
        ).fetchone()[0]


def get_board(user_id: int, board_id: int) -> BoardRow | None:
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT id, name, data, version, updated_at FROM boards WHERE id = ? AND user_id = ?",
            (board_id, user_id),
        ).fetchone()
    return BoardRow(*row) if row else None


def update_board(user_id: int, board_id: int, data: str, version: int) -> int | None:
    """Save the board only if it is still at `version`.

    Returns the new version, or None if the board was changed by someone else
    in the meantime (or does not exist).
    """
    with closing(connect()) as conn:
        row = conn.execute(
            "UPDATE boards SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP"
            " WHERE id = ? AND user_id = ? AND version = ? RETURNING version",
            (data, board_id, user_id, version),
        ).fetchone()
    return row[0] if row else None


def rename_board(user_id: int, board_id: int, name: str) -> bool:
    """Rename the board; False if it does not exist."""
    with closing(connect()) as conn:
        cursor = conn.execute(
            "UPDATE boards SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
            (name, board_id, user_id),
        )
    return cursor.rowcount == 1


def delete_board(user_id: int, board_id: int) -> bool:
    """Delete the board; False if it does not exist."""
    with closing(connect()) as conn:
        cursor = conn.execute("DELETE FROM boards WHERE id = ? AND user_id = ?", (board_id, user_id))
    return cursor.rowcount == 1
