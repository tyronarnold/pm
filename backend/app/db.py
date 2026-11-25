import os
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import NamedTuple

# AUTOINCREMENT: a deleted user's id is never given to a new user. Sessions identify the
# user by id, so a reused id would let an old session of a deleted account sign in as
# whoever was given that id next.
def _users_schema(table: str) -> str:
    return f"""
CREATE TABLE IF NOT EXISTS {table} (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    session_version INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
"""


USERS_SCHEMA = _users_schema("users")

# Databases from before AUTOINCREMENT. SQLite cannot change a key in place, so the table
# is rebuilt the documented way: with foreign keys off (dropping `users` must not delete
# boards), copy into a new table, drop the old one and rename the new one to `users`, so
# the references in other tables resolve to it.
USERS_AUTOINCREMENT_MIGRATION = f"""
PRAGMA foreign_keys = OFF;
BEGIN;
{_users_schema("users_new")}
INSERT INTO users_new (id, username, password_hash, session_version, is_admin, created_at)
    SELECT id, username, password_hash, session_version, is_admin, created_at FROM users;
DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
COMMIT;
PRAGMA foreign_keys = ON;
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

# Users a board is shared with. The owner (boards.user_id) is not listed here.
MEMBERS_SCHEMA = """
CREATE TABLE IF NOT EXISTS board_members (
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user_id ON board_members (user_id);
"""

# What happened on a board. The username is kept as text, so entries outlive the account.
ACTIVITY_SCHEMA = """
CREATE TABLE IF NOT EXISTS board_activity (
    id INTEGER PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    message TEXT NOT NULL,
    via_ai INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS board_activity_board_id ON board_activity (board_id, id);
"""

# Each board keeps this many activity entries; older ones are removed as new ones are added.
ACTIVITY_KEPT = 200

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
    is_admin: bool


class Activity(NamedTuple):
    username: str
    message: str
    via_ai: bool
    created_at: str


class UserSummary(NamedTuple):
    """A user as admins see them."""

    username: str
    is_admin: bool
    created_at: str
    boards: int  # boards they own


class BoardRow(NamedTuple):
    id: int
    name: str
    data: str
    version: int
    updated_at: str
    owner: str  # the owner's username


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
        if "is_admin" not in users:
            conn.execute("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        users_sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = 'users'").fetchone()[0]
        if "AUTOINCREMENT" not in users_sql:
            conn.executescript(USERS_AUTOINCREMENT_MIGRATION)
        old_boards = _columns(conn, "boards")
        if old_boards and "name" not in old_boards:
            if "version" not in old_boards:
                conn.execute("ALTER TABLE boards ADD COLUMN version INTEGER NOT NULL DEFAULT 1")
            conn.executescript(MULTIPLE_BOARDS_MIGRATION)
        conn.executescript(BOARDS_SCHEMA)
        conn.executescript(MEMBERS_SCHEMA)
        conn.executescript(ACTIVITY_SCHEMA)


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
            "SELECT id, username, session_version, is_admin FROM users WHERE id = ?", (user_id,)
        ).fetchone()
    return User(*row[:3], bool(row[3])) if row else None


def find_user(username: str) -> tuple[User, str | None] | None:
    """The user and their password hash, or None if there is no such user."""
    with closing(connect()) as conn:
        row = conn.execute(
            "SELECT id, username, session_version, is_admin, password_hash FROM users WHERE username = ?",
            (username,),
        ).fetchone()
    return (User(*row[:3], bool(row[3])), row[4]) if row else None


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


# Administration


def list_users() -> list[UserSummary]:
    """Every user, by username, with the number of boards they own."""
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT users.username, users.is_admin, users.created_at, COUNT(boards.id)"
            " FROM users LEFT JOIN boards ON boards.user_id = users.id"
            " GROUP BY users.id ORDER BY users.username"
        ).fetchall()
    return [UserSummary(row[0], bool(row[1]), row[2], row[3]) for row in rows]


def set_admin(user_id: int, is_admin: bool) -> None:
    with closing(connect()) as conn:
        conn.execute("UPDATE users SET is_admin = ? WHERE id = ?", (is_admin, user_id))


def count_admins() -> int:
    with closing(connect()) as conn:
        return conn.execute("SELECT COUNT(*) FROM users WHERE is_admin = 1").fetchone()[0]


def ensure_an_admin(username: str) -> None:
    """Make the user an admin if nobody is one (new databases, and those from before admins)."""
    with closing(connect()) as conn:
        conn.execute(
            "UPDATE users SET is_admin = 1 WHERE username = ?"
            " AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)",
            (username,),
        )


# Boards. Reads and saves are limited to boards the user owns or is a member of
# (`ACCESS`); renaming and deleting to boards the user owns. So a user can never
# read or change a board that was not shared with them.

ACCESS = "(boards.user_id = :user OR boards.id IN (SELECT board_id FROM board_members WHERE user_id = :user))"

BOARD_COLUMNS = (
    "SELECT boards.id, boards.name, boards.data, boards.version, boards.updated_at, owners.username"
    " FROM boards JOIN users AS owners ON owners.id = boards.user_id"
)


def list_boards(user_id: int) -> list[BoardRow]:
    """The boards the user owns or is a member of, oldest first."""
    with closing(connect()) as conn:
        rows = conn.execute(f"{BOARD_COLUMNS} WHERE {ACCESS} ORDER BY boards.id", {"user": user_id}).fetchall()
    return [BoardRow(*row) for row in rows]


def create_board(user_id: int, name: str, data: str) -> int:
    """Create a board at version 1 and return its id."""
    with closing(connect()) as conn:
        return conn.execute(
            "INSERT INTO boards (user_id, name, data) VALUES (?, ?, ?) RETURNING id",
            (user_id, name, data),
        ).fetchone()[0]


def get_board(user_id: int, board_id: int) -> BoardRow | None:
    """The board, if the user owns it or is a member."""
    with closing(connect()) as conn:
        row = conn.execute(
            f"{BOARD_COLUMNS} WHERE boards.id = :board AND {ACCESS}", {"board": board_id, "user": user_id}
        ).fetchone()
    return BoardRow(*row) if row else None


def update_board(user_id: int, board_id: int, data: str, version: int) -> int | None:
    """Save the board only if it is still at `version` (owner or member).

    Returns the new version, or None if the board was changed by someone else
    in the meantime (or does not exist, or is not shared with the user).
    """
    with closing(connect()) as conn:
        row = conn.execute(
            "UPDATE boards SET data = :data, version = version + 1, updated_at = CURRENT_TIMESTAMP"
            f" WHERE id = :board AND version = :version AND {ACCESS} RETURNING version",
            {"data": data, "board": board_id, "version": version, "user": user_id},
        ).fetchone()
    return row[0] if row else None


def rename_board(owner_id: int, board_id: int, name: str) -> bool:
    """Rename the board; False if it does not exist or is not the owner's."""
    with closing(connect()) as conn:
        cursor = conn.execute(
            "UPDATE boards SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?",
            (name, board_id, owner_id),
        )
    return cursor.rowcount == 1


def delete_board(owner_id: int, board_id: int) -> bool:
    """Delete the board (and its memberships); False if it does not exist or is not the owner's."""
    with closing(connect()) as conn:
        cursor = conn.execute("DELETE FROM boards WHERE id = ? AND user_id = ?", (board_id, owner_id))
    return cursor.rowcount == 1


# Members of a shared board.


def list_members(board_id: int) -> list[str]:
    """Usernames of the board's members (not the owner), in the order they were added."""
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT users.username FROM board_members JOIN users ON users.id = board_members.user_id"
            " WHERE board_members.board_id = ? ORDER BY board_members.rowid",
            (board_id,),
        ).fetchall()
    return [row[0] for row in rows]


def add_member(board_id: int, user_id: int) -> bool:
    """Share the board with the user; False if they are already a member."""
    with closing(connect()) as conn:
        cursor = conn.execute(
            "INSERT INTO board_members (board_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING",
            (board_id, user_id),
        )
    return cursor.rowcount == 1


def remove_member(board_id: int, user_id: int) -> bool:
    """Stop sharing the board with the user; False if they were not a member."""
    with closing(connect()) as conn:
        cursor = conn.execute(
            "DELETE FROM board_members WHERE board_id = ? AND user_id = ?", (board_id, user_id)
        )
    return cursor.rowcount == 1


# Activity


def add_activity(board_id: int, username: str, messages: list[str], via_ai: bool = False) -> None:
    """Record what the user did on the board, keeping the newest ACTIVITY_KEPT entries."""
    if not messages:
        return
    with closing(connect()) as conn:
        conn.executemany(
            "INSERT INTO board_activity (board_id, username, message, via_ai) VALUES (?, ?, ?, ?)",
            [(board_id, username, message, via_ai) for message in messages],
        )
        conn.execute(
            "DELETE FROM board_activity WHERE board_id = ? AND id NOT IN"
            " (SELECT id FROM board_activity WHERE board_id = ? ORDER BY id DESC LIMIT ?)",
            (board_id, board_id, ACTIVITY_KEPT),
        )


def list_activity(board_id: int, limit: int) -> list[Activity]:
    """The board's newest activity entries, newest first."""
    with closing(connect()) as conn:
        rows = conn.execute(
            "SELECT username, message, via_ai, created_at FROM board_activity"
            " WHERE board_id = ? ORDER BY id DESC LIMIT ?",
            (board_id, limit),
        ).fetchall()
    return [Activity(row[0], row[1], bool(row[2]), row[3]) for row in rows]
