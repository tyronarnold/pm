# Backend

Python 3.15, FastAPI, served by uvicorn on port 8000 inside the Docker container. Dependencies are managed with uv (`pyproject.toml`, `uv.lock`).

## Code

- `app/main.py`: FastAPI app. API routes live under `/api`; everything else is served from `static/` (mounted last so API routes take priority). Sign-in uses Starlette `SessionMiddleware` (signed `session` cookie holding the user id, `same_site=lax`; secret and Secure flag from `auth`). The `current_user` dependency (`CurrentUser` annotation) loads the user from the database on every request and returns 401 when not signed in or the account no longer exists; use it on every protected route. `find_board` returns the user's board or raises 404. `create_account` creates a user with a first board of sample cards. On startup (lifespan) it creates or upgrades the database and creates the demo `user` / `password` account if missing.
- `app/auth.py`: argon2id password hashing (`hash_password`, `verify_password`; an unknown user is checked against a dummy hash so it takes as long as a wrong password). `session_secret()` reads `SESSION_SECRET` (random fallback with a warning: restarts then sign everyone out); `https_only()` reads `SESSION_HTTPS_ONLY=true`. Login rate limiting in memory: 5 failures for a username within 15 minutes lock that username until the oldest failure expires (`is_locked_out`, `record_failure`, `clear_failures`; keyed by username because behind Docker every client has the same address)
- `app/db.py`: SQLite with the built-in `sqlite3` module. File at `DB_PATH` (default `/app/data/pm.db`, the `pm-data` volume). `init_db` creates the tables and upgrades older databases (adds missing columns; rebuilds the one-board-per-user `boards` table). Users: `create_user` (None if the name is taken), `ensure_password`, `get_user`, `find_user` (user and hash by name), `get_password_hash`, `set_password_hash`, `delete_user` (cascades to boards). Boards, every query limited to the owner's `user_id`: `list_boards`, `create_board`, `get_board`, `update_board(user_id, board_id, data, version)` (saves only if the board is still at `version`; returns the new version or None), `rename_board`, `delete_board`. Rows come back as `User` and `BoardRow` named tuples. See `docs/DATABASE.md`.
- `app/board.py`: Pydantic `Board` / `Column` / `Card` models (matches `docs/board.schema.json`; also checks every card is in exactly one column and card keys match ids), `DEFAULT_BOARD` (the sample cards a new account starts with), `EMPTY_BOARD` (the same columns, no cards; for new boards), `column_ids`. `Operation` (`create_card` / `edit_card` / `move_card` / `delete_card`; unused fields are null) and `apply_operations(board, operations)`: returns `Applied(board, skipped)`, a new board with the operations applied in order plus the operations it skipped (unknown card or column ids, an empty title, or an edit that changes nothing). New cards get a `card-<random>` id; the temporary `card_id` the AI gives in `create_card` maps to that id for later operations in the same list, so the AI can create a card and then move or edit it in one reply. `position` null means bottom of the column.
- `app/ai.py`: OpenRouter via the `openai` SDK (`base_url` https://openrouter.ai/api/v1, key from `OPENROUTER_API_KEY`), model `anthropic/claude-haiku-5.5` with OpenRouter's `reasoning: {"effort": "low"}` (passed in `extra_body`). `ask(messages)` returns plain reply text. `chat(board, history, message)` sends `SYSTEM_PROMPT`, the board JSON (second system message), the history and the new message, and uses Structured Outputs (`chat.completions.parse` with `response_format=ChatResult`) to get `{reply, operations}`. Failures (timeout, connection or HTTP errors, a reply cut off, or a refusal) are logged and raised as `AIError`, whose message is written for the user. The client has a 30 second timeout (`TIMEOUT_SECONDS`) and retries once. `client()` is created per call, so tests replace it with a fake.
- `app/openapi.py`: `schema()` returns the app's OpenAPI schema; `python -m app.openapi <path>` writes it to a file. `openapi.json` (committed) is the saved copy the frontend's TypeScript types are generated from; `tests/test_openapi.py` fails when it is out of date. After changing a Pydantic model or route, run `npm run api:types` in `frontend/` and commit both generated files
- `static/`: not in the repo. The Docker build copies the frontend's static export (`frontend/out`) here, so the app only runs inside the container.
- `tests/`: pytest tests using FastAPI's `TestClient`. `conftest.py` points `DB_PATH` at a temporary file for every test and provides the `client`, `signed_in` (demo user) and `board_id` (the demo user's first board) fixtures and the `login` / `register` helpers. Use `with TestClient(app) as client` for a second session (another user, or the same user elsewhere), so the startup code runs. `test_accounts.py` covers registration, password changes and account deletion; `test_board.py` the board routes, ownership and database upgrades. Tests that call OpenRouter are marked `live` and skipped when `OPENROUTER_API_KEY` is not set; all other AI tests replace `ai.client` with a fake (see `tests/test_chat.py`).

## Routes

Accounts:
- `GET /api/health`: returns `{"status": "ok"}`
- `POST /api/register` `{username, password}`: creates the account (username 3-32 of `a-z 0-9 . _ -`, password at least 8 characters; 422 otherwise) with a first board of sample cards, signs in and returns `{username}` (201); 409 if the username is taken
- `POST /api/login` `{username, password}`: checks the password against the stored argon2 hash (the demo account is `user` / `password`); sets the session, returns `{username}`; 401 on bad credentials; 429 after 5 failed attempts for that username within 15 minutes (each `detail` is a message for the user)
- `POST /api/logout`: clears the session
- `GET /api/me`: returns `{username}`; 401 when signed out
- `PUT /api/me/password` `{current_password, new_password}`: changes the password; 403 if the current password is wrong
- `DELETE /api/me` `{password}`: deletes the account and its boards and signs out (204); 403 if the password is wrong. Other sessions of that account get 401 from then on

Boards (all 401 when signed out, 404 for a board that does not exist or is not yours):
- `GET /api/boards`: the user's boards, oldest first, as `[{id, name, updated_at}]`
- `POST /api/boards` `{name}`: creates a board with the standard columns and no cards; returns `{id, name, version, board}` (201). Names are trimmed and must be 1-100 characters
- `GET /api/boards/{id}`: returns `{id, name, version, board}`
- `PATCH /api/boards/{id}` `{name}`: renames the board (does not change its version); returns `{id, name, updated_at}`
- `DELETE /api/boards/{id}`: deletes the board (204)
- `PUT /api/boards/{id}` `{version, board}`: validates and saves the whole board if it is still at `version`, returns `{version, board}` with the new version; 409 with the current `{version, board}` if it changed since; 422 if invalid or if column ids differ from the stored ones (renames are fine)
- `POST /api/boards/{id}/chat` `{message, history}` (history: list of `{role: "user" | "assistant", content}`): asks the AI about that board, then applies the returned operations to its latest saved version (the user may have saved while the AI was working) and saves it if it changed; returns `{reply, board, version}` with `board` null when nothing changed. If some operations were skipped, a note saying how many is appended to `reply` (so the user, and the AI through the history, know). 502 with a user-facing `detail` when the AI call fails; 409 if the board changed again during that final save

## Commands

Tests run inside the container image (built by `scripts/start.*` or `docker build -t pm .`):

```
docker run --rm pm uv run --no-sync pytest                          live tests skipped
docker run --rm --env-file .env pm uv run --no-sync pytest          all tests, including live
docker run --rm --env-file .env pm uv run --no-sync pytest -m live  live tests only
```

uv is not installed on the host. To change dependencies, run uv in a container from the repo root:

```
docker run --rm -v "$PWD/backend:/work" -w /work ghcr.io/astral-sh/uv:0.13.9-python3.15-trixie-slim uv add <package>
```
