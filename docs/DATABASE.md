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
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS boards (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

- `boards.user_id` is unique: one board per user for the MVP. Allowing several boards later means dropping that constraint and adding a `name` column.
- `users` has no password column. Sign-in is hardcoded (`user` / `password`) for the MVP; a password hash column can be added when real accounts arrive.
- Timestamps are UTC text (`YYYY-MM-DD HH:MM:SS`). `updated_at` is set on every save.

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
2. The first `GET /api/board` for a user with no board row inserts the default board (the five columns and eight sample cards from the current demo: Backlog, Discovery, In Progress, Review, Done) and returns it.
3. After that, reads and writes go to that user's row.

There are no migrations for the MVP. If the schema changes, delete the volume (`docker volume rm pm-data`) to start fresh.
