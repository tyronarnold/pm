# Database

SQLite, accessed with Python's built-in `sqlite3` module (no ORM).

## Location

- Path comes from the `DB_PATH` environment variable, default `/app/data/pm.db`.
- `/app/data` is the `pm-data` Docker volume, so the data survives container restarts and rebuilds.
- Tests set `DB_PATH` to a temporary file.

## Tables

```sql
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    session_version INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS board_members (
    board_id INTEGER NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (board_id, user_id)
);
CREATE INDEX IF NOT EXISTS board_members_user_id ON board_members (user_id);
```

- A user has any number of boards. Deleting a user deletes their boards (`ON DELETE CASCADE`, with `PRAGMA foreign_keys = ON` set on every connection).
- `boards.user_id` is the owner. `board_members` lists the other users a board is shared with (the owner is not listed); members are listed in the order they were added (`rowid`). Deleting a board or either user removes the membership.
- Board reads and saves in `db.py` are limited to the owner and members (the `ACCESS` condition); renames and deletes to the owner. The API answers 404 for "no such board" and "not shared with you" alike, and 403 when a member tries an owner-only action.
- `users.username` is 3-32 lowercase letters, digits, `.`, `_` or `-` (checked by the API, not the database).
- `users.password_hash` holds an argon2id hash (argon2-cffi), never the password. On startup the demo `user` account is created with the hash of `password` if missing, or given that hash if it has none (databases from before hashing); an existing hash is never replaced. Sign-in checks the hash.
- `users.session_version` is copied into the session cookie at sign-in and checked on every request. Changing the password increments it, so every other session is signed out (the session that made the change is given the new value and stays signed in).
- `users.is_admin` (0 or 1) marks admins. At startup, if no user is an admin, the demo `user` account becomes one, so a new or upgraded database always has an admin; the API refuses to remove the last admin.
- Timestamps are UTC text (`YYYY-MM-DD HH:MM:SS`). `updated_at` is set on every save and rename.
- `boards.version` starts at 1 and goes up by one on every save of the board data (not on renames). It is used for optimistic concurrency (see Saving below).

## Saving

Every save says which version it was based on, and only succeeds if the board is still at that version:

```sql
UPDATE boards SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE id = ? AND user_id = ? AND version = ?
RETURNING version
```

If no row is updated, someone else (another tab, or the AI chat) saved first. `PUT /api/boards/{id}` then returns `409` with the current `{version, board}`, so a stale save can never overwrite a newer board. The AI chat applies its operations to the latest saved board after the model replies, and saves with the same check.

## Board JSON

`boards.data` holds the whole board as one JSON document, in the shape defined by the `Board` model in `backend/app/board.py`. The frontend's `BoardData` type (`frontend/src/lib/kanban.ts`) is generated from that model (see `npm run api:types`). The schema is in [board.schema.json](board.schema.json).

```json
{
  "columns": [
    { "id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"] }
  ],
  "cards": {
    "card-1": {
      "id": "card-1", "title": "Align roadmap themes", "details": "...",
      "priority": "high", "dueDate": "2026-12-12", "labels": ["planning"]
    }
  }
}
```

- Card order within a column is the order of `cardIds`.
- `priority` (`low` / `medium` / `high`), `dueDate` (`YYYY-MM-DD`) and `labels` (up to 10, each 1-30 characters after trimming) are optional. They were added after boards were already stored, so cards without them are still valid and are read as `null`, `null` and `[]`; no data migration was needed.
- Saving replaces the whole document (`PUT /api/boards/{id}`, and the AI chat after applying its operations).
- The backend validates the shape with Pydantic models matching the schema, plus checks the schema cannot express:
  - every card id appears in exactly one column, and every id in `cardIds` has a card in `cards` (so a column can only be removed once it is empty)
  - column ids are unique, and no column has the same id as a card (drag and drop uses both as targets)
- Columns are otherwise free: a board can have any number of columns in any order (Part 14; before that the five standard columns were fixed). The last column counts as finished work.

## Startup and new accounts

1. On startup the backend creates the database file and tables if missing, upgrades older databases (below), and creates the demo `user` account if missing.
2. A new account (the demo account, or one made with `POST /api/register`) gets one board, "My first board", holding the sample cards (the five columns Backlog, Discovery, In Progress, Review, Done and eight cards).
3. A board made with `POST /api/boards` has the same five columns and no cards.

## Upgrading older databases

There is no migration framework; `init_db` upgrades databases made by earlier versions, keeping their data:

- `users.password_hash` missing: added with `ALTER TABLE` (the `user` account then gets its hash at startup).
- `users.session_version` missing: added with `ALTER TABLE` (default 0). Sessions signed before it existed have no version in their cookie, so their users sign in once more.
- `boards.version` missing: added with `ALTER TABLE` (boards start at version 1).
- `users.is_admin` missing: added with `ALTER TABLE` (default 0); the startup rule above then makes `user` an admin.
- `board_members` missing: created like any new table (`CREATE TABLE IF NOT EXISTS`).
- `boards.name` missing (the one-board-per-user design, where `boards.user_id` was `UNIQUE`): SQLite cannot drop a constraint, so the table is rebuilt in one transaction (rename, create the new table, copy every row, drop the old one). Board ids and versions are kept, and each board is named "My board".

For larger changes, deleting the volume (`docker volume rm pm-data`) starts fresh, at the cost of all saved boards.
