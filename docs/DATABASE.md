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
```

- A user has any number of boards. Deleting a user deletes their boards (`ON DELETE CASCADE`, with `PRAGMA foreign_keys = ON` set on every connection).
- Every board query in `db.py` is limited by `user_id` as well as the board id, so one user can never read or change another user's board; the API answers 404 for both "no such board" and "not yours".
- `users.username` is 3-32 lowercase letters, digits, `.`, `_` or `-` (checked by the API, not the database).
- `users.password_hash` holds an argon2id hash (argon2-cffi), never the password. On startup the demo `user` account is created with the hash of `password` if missing, or given that hash if it has none (databases from before hashing); an existing hash is never replaced. Sign-in checks the hash.
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
    "card-1": { "id": "card-1", "title": "Align roadmap themes", "details": "..." }
  }
}
```

- Card order within a column is the order of `cardIds`.
- Saving replaces the whole document (`PUT /api/boards/{id}`, and the AI chat after applying its operations).
- The backend validates the shape with Pydantic models matching the schema, plus two checks the schema cannot express:
  - every card id appears in exactly one column, and every id in `cardIds` has a card in `cards`
  - the column ids match the stored board's column ids, in order (columns are fixed; only titles change)

## Startup and new accounts

1. On startup the backend creates the database file and tables if missing, upgrades older databases (below), and creates the demo `user` account if missing.
2. A new account (the demo account, or one made with `POST /api/register`) gets one board, "My first board", holding the sample cards (the five columns Backlog, Discovery, In Progress, Review, Done and eight cards).
3. A board made with `POST /api/boards` has the same five columns and no cards.

## Upgrading older databases

There is no migration framework; `init_db` upgrades databases made by earlier versions, keeping their data:

- `users.password_hash` missing: added with `ALTER TABLE` (the `user` account then gets its hash at startup).
- `boards.version` missing: added with `ALTER TABLE` (boards start at version 1).
- `boards.name` missing (the one-board-per-user design, where `boards.user_id` was `UNIQUE`): SQLite cannot drop a constraint, so the table is rebuilt in one transaction (rename, create the new table, copy every row, drop the old one). Board ids and versions are kept, and each board is named "My board".

For larger changes, deleting the volume (`docker volume rm pm-data`) starts fresh, at the cost of all saved boards.
