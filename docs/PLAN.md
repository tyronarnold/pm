# Project Plan

Each part has a checklist (checked off as work is done), tests, and success criteria. Work stops for user review at the end of Part 1 and Part 5.

## Decisions

- AI model: `anthropic/claude-haiku-5.5` via OpenRouter, reasoning effort `low`. The OpenRouter call uses the `openai` Python SDK pointed at `https://openrouter.ai/api/v1`.
- Sign-in: backend checks the hardcoded credentials and sets a signed session cookie (Starlette `SessionMiddleware`). All `/api` routes except login require it.
- Database: SQLite. One row per user's board, holding the whole board as JSON (same `BoardData` shape the frontend uses).
- AI board changes: the AI returns a list of operations (create / edit / move / delete card), applied by the backend. Not a whole-board replacement.
- Chat history: kept in the browser only, sent with each chat request, lost on refresh.
- Tests: backend tests run inside the Docker container. Frontend unit tests run locally with npm. Playwright e2e tests run locally against the running container. Only the "2+2" connectivity test calls OpenRouter for real; all other AI tests use faked responses.
- App URL: http://localhost:8000. SQLite file lives in a named Docker volume so data survives restarts.

## Target layout

```
Dockerfile               multi-stage: build frontend (Node), run backend (Python + uv)
.dockerignore
backend/
  pyproject.toml, uv.lock
  app/main.py            FastAPI app, routes, static file serving
  app/db.py              SQLite access
  app/board.py           board models, default board, operations
  app/ai.py              OpenRouter calls
  tests/
frontend/                Next.js, built with `output: "export"` into frontend/out
scripts/
  start.sh, stop.sh      Mac and Linux
  start.ps1, stop.ps1    Windows
docs/
```

---

## Part 1: Plan

- [x] Review AGENTS.md and the existing frontend
- [x] Resolve open questions with the user (see Decisions)
- [x] Upgrade frontend dependencies to latest (TypeScript held at 6.0.x because typescript-eslint does not support 7 yet)
- [x] Expand this plan with checklists, tests and success criteria
- [x] Write frontend/AGENTS.md describing the existing code
- [x] User reviews and approves this plan

Success criteria: user approves the plan.

---

## Part 2: Scaffolding

- [x] `backend/pyproject.toml` managed by uv (Python 3.15): `fastapi`, `uvicorn[standard]`; dev group: `pytest`, `httpx2` (Starlette's test client deprecates `httpx`)
- [x] `backend/app/main.py`: `GET /api/health` returns `{"status": "ok"}`; serves `backend/static/index.html` (hello world page that calls `/api/health` and shows the result) at `/`
- [x] `Dockerfile` based on `python:3.15-slim` with uv 0.13.9 copied in; `uv sync --frozen`; runs `uvicorn` on port 8000
- [x] `.dockerignore` (node_modules, .next, out, .venv, .env, test-results)
- [x] `scripts/start.sh` / `start.ps1`: build the image, remove any old container, run a new one detached with `--env-file .env`, port 8000, and the data volume
- [x] `scripts/stop.sh` / `stop.ps1`: stop and remove the container
- [x] Backend tests run with `docker run --rm pm uv run --no-sync pytest`
- [x] Update `backend/AGENTS.md` and `scripts/AGENTS.md`; minimal root README with start/stop/test commands
- [x] `.gitattributes` keeps `.sh` files LF; Playwright output ignored in `frontend/.gitignore`

Tests:
- pytest: `/api/health` returns 200 and `{"status": "ok"}`; `/` returns the hello world HTML

Success criteria:
- `scripts/start.ps1` brings the app up; http://localhost:8000 shows the hello world page and the result of the API call
- `scripts/stop.ps1` stops it; the port is free afterwards
- Backend tests pass in the container

---

## Part 3: Add in Frontend

- [x] Set `output: "export"` in `next.config.ts`; `npm run build` writes static files to `frontend/out`
- [x] Dockerfile gets a Node build stage (`node:26-slim`) that runs `npm ci` and `npm run build`; the Python stage copies `out/` in and FastAPI serves it at `/` (`StaticFiles(html=True)`), with `/api` routes registered first
- [x] Remove the hello world page
- [x] Add card editing (Edit button on each card opens an inline form for title and details; save / cancel), since AGENTS.md requires it and the demo lacks it
- [x] Point Playwright at the container (`baseURL` http://127.0.0.1:8000, no dev `webServer`)

Tests:
- Vitest: card editing (edit, save, cancel, empty title rejected); existing board tests still pass
- pytest: `/` returns the exported `index.html`; static assets under `/_next/` return 200; `/api/health` still works
- Playwright (against the container): board loads, add card, edit card, move card between columns, rename column

Success criteria:
- http://localhost:8000 shows the Kanban board from the container
- No console or hydration errors on load
- All frontend unit, backend and e2e tests pass

---

## Part 4: Fake user sign in

- [x] Backend: `SessionMiddleware` with a secret generated at startup (sessions end when the container restarts, acceptable for the MVP)
- [x] `POST /api/login` checks `user` / `password`, stores the username in the session; wrong credentials return 401
- [x] `POST /api/logout` clears the session; `GET /api/me` returns the username or 401
- [x] A `current_user` dependency that returns 401 when not signed in, used by every protected route
- [x] Frontend: on load call `/api/me`; show a login form when signed out, the board when signed in; a log out button in the header
- [x] Login form styled with the project colors; error message on bad credentials

Tests:
- pytest: login success sets cookie; wrong password 401; `/api/me` before and after login; logout clears session
- Vitest: login form submits credentials, shows error on 401, shows board on success; log out returns to the form
- Playwright: visiting `/` shows the login form; bad credentials show an error; good credentials show the board; log out returns to the form; refresh while signed in keeps you signed in

Success criteria: the board is only reachable after signing in with `user` / `password`, and log out works.

---

## Part 5: Database modeling

- [x] Write `docs/DATABASE.md`: SQLite file location, tables, how the board JSON is stored, how a new user's default board is created
- [x] Write `docs/board.schema.json`: JSON Schema for the stored board (columns with id, title, cardIds; cards keyed by id with id, title, details)
- [x] Proposed tables:
  - `users`: `id` integer primary key, `username` text unique, `created_at`
  - `boards`: `id` integer primary key, `user_id` unique foreign key to users, `data` text (board JSON), `updated_at`
- [x] User reviews and signs off

Success criteria: user approves the schema and approach.

---

## Part 6: Backend

- [x] `app/db.py`: open SQLite at `DB_PATH` (default `/app/data/pm.db`), create tables if missing, seed the `user` row
- [x] `app/board.py`: Pydantic models for the board; the default board (same five columns and sample cards as the demo)
- [x] `GET /api/board`: returns the signed-in user's board, creating the default board on first access
- [x] `PUT /api/board`: validates and saves the whole board
- [x] Column set is fixed: `PUT` rejects a board whose column ids differ from the stored ones (renaming is allowed)

Tests (pytest, each test uses a temporary database file):
- Database and tables are created when the file does not exist
- First `GET` returns the default board; `PUT` then `GET` returns the saved board
- Both routes return 401 when signed out
- Invalid board JSON returns 422; changed column ids are rejected
- Two users have separate boards (inserted directly into the database, since only `user` can sign in)

Success criteria: board data persists across container restarts (named volume) and all tests pass.

---

## Part 7: Frontend + Backend

- [x] Frontend loads the board from `GET /api/board` after sign-in, with a simple loading state
- [x] Every change (move, add, edit, delete, rename) updates local state and then sends the whole board with `PUT /api/board`
- [x] Column rename saves on blur / Enter rather than every keystroke
- [x] A failed save shows a short error message

Tests:
- Vitest: API calls mocked with `vi.fn`; board renders from the API response; each action triggers a `PUT` with the expected board
- Playwright: add, edit, move, delete and rename, then reload the page and confirm every change persisted. Each test resets the board first, and tests run with one worker since they share one board
- Container restart persistence is checked by hand with the API (sessions end on restart, so it does not fit a Playwright test) and by the backend restart test

Success criteria: the board is fully persistent per user, with no data loss on reload or container restart.

---

## Part 8: AI connectivity

- [x] Add the `openai` package; `app/ai.py` creates a client with `base_url="https://openrouter.ai/api/v1"` and `OPENROUTER_API_KEY`
- [x] `ask(messages)` function sends a chat completion to `anthropic/claude-haiku-5.5` with reasoning effort `low` (OpenRouter's `reasoning: {"effort": "low"}` via `extra_body`)
- [x] Live connectivity test asks "What is 2+2?" and checks the answer contains "4"; marked `live`, skipped when no API key is set

Tests:
- pytest (live): the 2+2 test passes in the container with the real key

Success criteria: a real OpenRouter call succeeds from inside the container.

---

## Part 9: AI board updates with Structured Outputs

- [x] `POST /api/chat` takes `{message, history}` (history is a list of `{role, content}`)
- [x] Backend sends: a system prompt explaining the board and the allowed operations, the current board JSON, the history, then the new message
- [x] Response format is a JSON schema (Structured Outputs) for `{reply, operations}`. Each operation has `type` (`create_card`, `edit_card`, `move_card`) and the fields it needs: `card_id`, `column_id`, `title`, `details`, `position` (strict schema, so every field is present and unused ones are null)
- [x] `app/board.py` `apply_operations(board, operations)`: pure function, applies operations in order; operations that reference unknown cards or columns are skipped
- [x] If any operations were applied, save the board. Return `{reply, board}`

Tests (pytest, AI call faked):
- `apply_operations`: create (in column, at position), edit title and details, move within and across columns, several operations in one reply, unknown ids skipped
- `/api/chat`: reply with no operations leaves board unchanged; reply with operations updates and persists the board; history and board JSON are included in the request sent to the model; 401 when signed out
- Live (marked `live`): asking to "add a card called Test to Backlog" produces a `create_card` operation

Success criteria: chat requests return a reply and, when the AI decides to, a correctly updated and saved board.

---

## Part 10: AI chat sidebar

- [x] `ChatSidebar` component: message list, input, send button (purple), loading indicator while waiting
- [x] Sidebar sits beside the board on wide screens (1536px+, so the five columns keep enough width) and can be collapsed; full width below the board on narrower screens
- [x] History kept in React state and sent with each message
- [x] When the response includes a board, replace the board state so the UI refreshes immediately
- [x] Error message in the sidebar if the chat request fails
- [x] Added after the MVP: the AI can also delete cards (`delete_card` operation); the system prompt tells it to delete only cards the user clearly asked for and to ask when unclear
- [x] Fix found by the e2e test: the AI could not move or edit a card it created in the same reply (it had no id yet). `create_card` now takes a temporary `card_id` that later operations in the same reply can use; the backend maps it to the generated id

Tests:
- Vitest (API mocked): sending a message shows it and the reply; history is sent on the next message; a returned board updates the columns; error state shows
- Playwright (live AI): ask the AI to create a card and move it to Done; the card appears in Done without a page reload and is still there after reload

Success criteria: a user can manage cards through chat, and the board updates automatically when the AI changes it.
