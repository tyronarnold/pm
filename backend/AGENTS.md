# Backend

Python 3.15, FastAPI, served by uvicorn on port 8000 inside the Docker container. Dependencies are managed with uv (`pyproject.toml`, `uv.lock`).

## Code

- `app/main.py`: FastAPI app. API routes live under `/api`; everything else is served from `static/` (mounted last so API routes take priority). Sign-in uses Starlette `SessionMiddleware` (signed `session` cookie) with a secret generated at startup, so sessions end when the container restarts. The `current_user` dependency returns 401 when not signed in; use it on every protected route. On startup (lifespan) it creates the database and the `user` row.
- `app/db.py`: SQLite with the built-in `sqlite3` module. File at `DB_PATH` (default `/app/data/pm.db`, the `pm-data` volume). `init_db` (also adds `boards.version` to older databases), `add_user`, `get_board` (returns `(json, version)`), `create_board` (version 1), `update_board(username, data, version)` (saves only if the board is still at `version`; returns the new version or None). See `docs/DATABASE.md`.
- `app/board.py`: Pydantic `Board` / `Column` / `Card` models (matches `docs/board.schema.json`; also checks every card is in exactly one column and card keys match ids), `DEFAULT_BOARD`, `column_ids`. `Operation` (`create_card` / `edit_card` / `move_card` / `delete_card`; unused fields are null) and `apply_operations(board, operations)`: returns `Applied(board, skipped)`, a new board with the operations applied in order plus the operations it skipped (unknown card or column ids, an empty title, or an edit that changes nothing). New cards get a `card-<random>` id; the temporary `card_id` the AI gives in `create_card` maps to that id for later operations in the same list, so the AI can create a card and then move or edit it in one reply. `position` null means bottom of the column.
- `app/ai.py`: OpenRouter via the `openai` SDK (`base_url` https://openrouter.ai/api/v1, key from `OPENROUTER_API_KEY`), model `anthropic/claude-haiku-5.5` with OpenRouter's `reasoning: {"effort": "low"}` (passed in `extra_body`). `ask(messages)` returns plain reply text. `chat(board, history, message)` sends `SYSTEM_PROMPT`, the board JSON (second system message), the history and the new message, and uses Structured Outputs (`chat.completions.parse` with `response_format=ChatResult`) to get `{reply, operations}`. Failures (timeout, connection or HTTP errors, a reply cut off, or a refusal) are logged and raised as `AIError`, whose message is written for the user. The client has a 30 second timeout (`TIMEOUT_SECONDS`) and retries once. `client()` is created per call, so tests replace it with a fake.
- `app/openapi.py`: `schema()` returns the app's OpenAPI schema; `python -m app.openapi <path>` writes it to a file. `openapi.json` (committed) is the saved copy the frontend's TypeScript types are generated from; `tests/test_openapi.py` fails when it is out of date. After changing a Pydantic model or route, run `npm run api:types` in `frontend/` and commit both generated files
- `static/`: not in the repo. The Docker build copies the frontend's static export (`frontend/out`) here, so the app only runs inside the container.
- `tests/`: pytest tests using FastAPI's `TestClient`. `conftest.py` points `DB_PATH` at a temporary file for every test. Use `with TestClient(app) as client` when a test needs the database, so the startup code runs. Tests that call OpenRouter are marked `live` and skipped when `OPENROUTER_API_KEY` is not set; all other AI tests replace `ai.client` with a fake (see `tests/test_chat.py`).

## Routes

- `GET /api/health`: returns `{"status": "ok"}`
- `POST /api/login` `{username, password}`: hardcoded `user` / `password`; sets the session, returns `{username}`; 401 on bad credentials
- `POST /api/logout`: clears the session
- `GET /api/me`: returns `{username}`; 401 when signed out
- `GET /api/board`: returns `{version, board}`, creating the default board (version 1) on first access; 401 when signed out
- `PUT /api/board` `{version, board}`: validates and saves the whole board if it is still at `version`, returns `{version, board}` with the new version; 409 with the current `{version, board}` if it changed since; 422 if invalid or if column ids differ from the stored ones (renames are fine); 401 when signed out
- `POST /api/chat` `{message, history}` (history: list of `{role: "user" | "assistant", content}`): asks the AI with the user's board, then applies the returned operations to the latest saved board (the user may have saved while the AI was working) and saves it if it changed; returns `{reply, board, version}` with `board` null when nothing changed. If some operations were skipped, a note saying how many is appended to `reply` (so the user, and the AI through the history, know). 502 with a user-facing `detail` when the AI call fails; 409 if the board changed again during that final save; 401 when signed out

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
