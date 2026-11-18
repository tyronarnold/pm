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
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    data TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- `boards.user_id` is unique: one board per user for the MVP. Allowing several boards later means dropping that constraint and adding a `name` column.
- `users.password_hash` holds an argon2id hash (argon2-cffi), never the password. On startup the MVP's `user` account gets the hash of `password` if it has none yet; an existing hash is never replaced. Sign-in checks the hash.
- Timestamps are UTC text (`YYYY-MM-DD HH:MM:SS`). `updated_at` is set on every save.
- `boards.version` starts at 1 and goes up by one on every save. It is used for optimistic concurrency (see Saving below).

## Saving

Every save says which version it was based on, and only succeeds if the board is still at that version:

```sql
UPDATE boards SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE username = ?) AND version = ?
RETURNING version
```

If no row is updated, someone else (another tab, or the AI chat) saved first. `PUT /api/board` then returns `409` with the current `{version, board}`, so a stale save can never overwrite a newer board. The AI chat applies its operations to the latest saved board after the model replies, and saves with the same check.

## Board JSON

`boards.data` holds the whole board as one JSON document, in the same shape the frontend uses (`BoardData` in `frontend/src/lib/kanban.ts`). The schema is in [board.schema.json](board.schema.json).

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
- Saving replaces the whole document (`PUT /api/board`, and the AI chat after applying its operations).
- The backend validates the shape with Pydantic models matching the schema, plus two checks the schema cannot express:
  - every card id appears in exactly one column, and every id in `cardIds` has a card in `cards`
  - the column ids match the stored board's column ids, in order (columns are fixed; only titles change)

## Startup and first use

1. On startup the backend creates the database file and tables if missing, and inserts the `user` row if missing (`INSERT OR IGNORE`).
2. The first `GET /api/board` for a user with no board row inserts the default board at version 1 (the five columns and eight sample cards from the current demo: Backlog, Discovery, In Progress, Review, Done) and returns it.
3. After that, reads and writes go to that user's row.

There is no migration framework. The schema changes so far (adding `boards.version` and `users.password_hash`) are handled in `init_db`: a missing column is added with `ALTER TABLE` and existing rows keep their data (boards start at version 1; the `user` account then gets its password hash at startup). For larger changes, deleting the volume (`docker volume rm pm-data`) starts fresh, at the cost of all saved boards.
