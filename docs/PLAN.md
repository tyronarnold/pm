# Project Plan

Each part has a checklist (checked off as work is done), tests, and success criteria. Work stops for user review at the end of Part 1 and Part 5.

## Decisions

- AI model: `anthropic/claude-haiku-5.5` via OpenRouter, reasoning effort `low`. The OpenRouter call uses the `openai` Python SDK pointed at `https://openrouter.ai/api/v1`.
- Sign-in: backend checks the password against an argon2 hash stored in `users` (the MVP account is still `user` / `password`) and sets a signed session cookie (Starlette `SessionMiddleware`). All `/api` routes except login require it. Session secret from `SESSION_SECRET`, login rate limited (see Follow-ups).
- Database: SQLite. One row per user's board, holding the whole board as JSON (same `BoardData` shape the frontend uses).
- AI board changes: the AI returns a list of operations (create / edit / move / delete card), applied by the backend. Not a whole-board replacement.
- Chat history: kept in the browser only, sent with each chat request, lost on refresh.
- Tests: backend tests run inside the Docker container. Frontend unit tests run locally with npm. Playwright e2e tests run locally against their own throwaway `pm-test` container on port 8001 (see Follow-ups). AI tests use faked responses, except a few tests that call OpenRouter for real: the backend tests marked `live` (2+2, create a card, create then move a card, delete a card; skipped without the API key) and the Playwright chat test.
- App URL: http://localhost:8000. SQLite file lives in a named Docker volume so data survives restarts.
- Look and feel (user decisions after the MVP, see Part 11): card colors per column and column styling from the user's reference image, a yellow left edge on card hover, #4C9BD2 header column chips, #BA001D Log out button, chat sidebar 25% smaller.
- Source control: the code lives at https://github.com/tyronarnold/pm (public, remote `origin`); the original course repo `ed-donner/pm` is kept as remote `upstream`. Work is committed to `main`.

## Target layout

```
Dockerfile               multi-stage: build frontend (Node), run backend (Python + uv)
.dockerignore
backend/
  pyproject.toml, uv.lock
  app/main.py            FastAPI app, middleware, startup, static file serving
  app/access.py          signed-in user, admins, board access checks
  app/routes/            API routes: accounts, admin, boards, chat
  app/auth.py            password hashing, session settings, login rate limiting
  app/db.py              SQLite access
  app/board.py           board models, default board, operations
  app/ai.py              OpenRouter calls
  tests/
frontend/                Next.js, built with `output: "export"` into frontend/out
scripts/
  start.sh, stop.sh      Mac and Linux
  start.ps1, stop.ps1    Windows
docs/
  PLAN.md                this plan
  DATABASE.md            database design
  board.schema.json      JSON Schema of the stored board
  tutorial.md            guided tour of the code for newer frontend developers
  screenshot.png         screenshot used by README.md and tutorial.md
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
- [x] Response format is a JSON schema (Structured Outputs) for `{reply, operations}`. Each operation has `type` (`create_card`, `edit_card`, `move_card`; `delete_card` added in Part 11) and the fields it needs: `card_id`, `column_id`, `title`, `details`, `position` (strict schema, so every field is present and unused ones are null)
- [x] `app/board.py` `apply_operations(board, operations)`: pure function, applies operations in order; operations that reference unknown cards or columns are skipped
- [x] If any operations were applied, save the board. Return `{reply, board}`

Tests (pytest, AI call faked):
- `apply_operations`: create (in column, at position), edit title and details, move within and across columns, several operations in one reply, unknown ids skipped, input board not changed; later operations can use a new card's temporary id, and a temporary id equal to an existing card id does not overwrite that card (added in Part 10)
- `/api/chat`: reply with no operations leaves board unchanged; reply with operations updates and persists the board; history and board JSON are included in the request sent to the model; invalid history role rejected; 401 when signed out
- Live (marked `live`): asking to "add a card called Test to Backlog" produces a `create_card` operation; "create a card, then move it to Done" ends with the card in Done (added in Part 10)

Success criteria: chat requests return a reply and, when the AI decides to, a correctly updated and saved board.

---

## Part 10: AI chat sidebar

- [x] `ChatSidebar` component: message list, input, send button (purple), loading indicator while waiting
- [x] Sidebar sits beside the board on wide screens (1536px+, so the five columns keep enough width) and can be collapsed; full width below the board on narrower screens (sizes reduced in Part 11)
- [x] History kept in React state and sent with each message
- [x] When the response includes a board, replace the board state so the UI refreshes immediately (the backend already saved it, so the frontend does not save it again)
- [x] Error message in the sidebar if the chat request fails
- [x] Fix found by the e2e test: the AI could not move or edit a card it created in the same reply (it had no id yet). `create_card` now takes a temporary `card_id` that later operations in the same reply can use; the backend maps it to the generated id

Tests:
- Vitest (API mocked): sending a message shows it and the reply; history is sent on the next message; a returned board is passed on and updates the columns without another save; loading indicator; error state; hide and show keeps the conversation
- Playwright (live AI): ask the AI to create a card and move it to Done; the card appears in Done without a page reload and is still there after reload

Success criteria: a user can manage cards through chat, and the board updates automatically when the AI changes it.

---

## Part 11: Changes after the MVP (user requests)

Visual refresh, from the user's reference images:
- [x] Card background color per column (`columnColors` in `kanban.ts`, CSS variables in `globals.css`): Backlog `#d9d9d9` gray, Discovery `#b3f5fa` cyan, In Progress `#c8bfe3` purple, Review `#f8d597` peach, Done `#b6e8c3` green
- [x] Columns: light surface (`#f8fafc`), yellow top border, bold uppercase editable title, card count badge on the right
- [x] Full-width blue (`#94bdf2`) "+ Add card" button at the bottom of each column
- [x] Card hover: yellow left edge (`--accent-yellow`), plus edit (pencil) and delete (X) icons in the top-right corner. The reference showed only the X; the pencil was added because editing is a requirement. Icons show on hover or keyboard focus on mouse devices and are always shown on touch screens

Header and sidebar:
- [x] Header column chips (Backlog ... Done) filled with `#4C9BD2`, white text (`--nav-chip`)
- [x] Log out button filled with `#BA001D`, white text (`--logout`)
- [x] Chat sidebar 25% smaller: 270px wide (was 360px) beside the board; message area 360px tall on wide screens (was 480px) and 240px below the board (was 320px). Input placeholder shortened to "Type a message" to fit
- [x] Sidebar hint text: "Ask me to create, edit, move or delete cards."

AI:
- [x] The AI can delete cards (`delete_card` operation, applied by the backend like the others). The system prompt tells it to delete only cards the user clearly asked for and to ask when unclear (checked live: "Delete a card." makes it ask which one)

Docs and repository:
- [x] Screenshot added to the top of `README.md` (`docs/screenshot.png`)
- [x] `docs/tutorial.md`: guided tour of the code for newer frontend developers, ending with a self-review
- [x] Code pushed to https://github.com/tyronarnold/pm

Tests:
- pytest: delete a card, delete a card created in the same reply, unknown card skipped; `/api/chat` saves a deletion; live: "Delete the QA micro-interactions card" removes exactly that card
- Vitest and Playwright updated for the restyled "Add card" button; all suites pass

---

## Follow-ups (all done)

From the self-review in `docs/tutorial.md`, section 7:
- [x] Prevent out-of-order and conflicting saves (version number on the board, `409` on stale writes; one pending save at a time in the frontend)
  - Backend: `boards.version` column (added to existing databases at startup, keeping their data); `GET /api/board` returns `{version, board}`; `PUT /api/board` takes `{version, board}` and returns `409` with the current board when the version is stale; the chat applies the AI's operations to the latest saved board after the model replies, and returns `board: null` when nothing changed
  - Frontend: saves are queued and sent one at a time with the last confirmed version; a `409` loads the server's board and shows "Your board was changed somewhere else..."; boards returned by the chat replace the local board and its version
  - Tests: pytest for versions, stale saves, upgrading an older database, and the AI applying its changes on top of a save made while it was working; Vitest for sequential saves, conflicts and chat versions; Playwright for two tabs editing the same board
- [x] Handle failures at the edges: board load error with retry, a timeout and clear error for AI calls, report skipped AI operations
  - Board load: `page.tsx` shows "Could not load your board..." with a "Try again" button when the sign-in check or board load fails (server error or unreachable), instead of hanging on "Loading board..."
  - AI calls: 30 second timeout with one retry; timeouts, connection and HTTP errors, cut-off replies and refusals become `AIError` with a user-facing message, returned as `502 {detail}` and shown as is in the chat sidebar
  - Skipped operations: `apply_operations` returns the skipped operations; the chat appends a note to the reply ("1 requested change could not be applied ..."), so the user and the AI (through the history) both know
  - Tests: pytest for timeout, connection error, refusal, the client's timeout settings, skipped notes; Vitest for load failure and retry, unreachable server, chat error messages; Playwright using `page.route` for a failed board load and a failed AI call
- [x] Run Playwright against a separate test container and volume, so e2e tests do not reset the real `user` board
  - `frontend/tests/global-setup.ts` (Playwright `globalSetup`) builds the image, starts a `pm-test` container on port 8001 and removes it after the run (also removes a leftover one from an interrupted run). It uses no volume at all: each run starts with an empty database, which is simpler than a separate named volume and needs no cleanup
  - Playwright's `baseURL` is http://127.0.0.1:8001; the real app on port 8000 no longer needs to be running for e2e tests
  - Checked: after a full run the real board was byte-for-byte unchanged (same version), and no `pm-test` container was left behind
- [x] Move frontend board updates into pure functions or a reducer; generate TypeScript types from FastAPI's OpenAPI schema so the two sides cannot drift (and align the empty-details default)
  - Pure functions rather than a reducer (`renameColumn`, `addCard`, `editCard`, `deleteCard` in `kanban.ts`, next to `moveCard`), because each change must hand the new board straight to the save queue; `KanbanBoard`'s handlers are now one line each
  - Types: `backend/openapi.json` (written by `python -m app.openapi`) is turned into `frontend/src/lib/api-types.ts` by openapi-typescript; `kanban.ts` and `api.ts` use those types. One command regenerates both: `npm run api:types`. openapi-typescript 7.13.0 runs through `npx` (user approved the download) rather than as a dependency, because it declares a TypeScript 5 peer and the project uses TypeScript 6
  - Drift is caught on both sides: a backend test fails if `openapi.json` is stale, and the frontend type check fails if the generated types no longer fit the frontend code (checked by renaming a field: 33 type errors)
  - The Dockerfile has a `backend` stage, which the generator builds on its own, so frontend type errors cannot block regenerating the types (found when the generator failed to recover from a broken `api-types.ts`)
  - Cards added in the UI without details now get an empty string, like cards the AI creates (was "No details yet.")
- [x] Real sign-in: hashed passwords in `users`, session secret from an environment variable, `https_only` cookie, login rate limiting
  - `users.password_hash` (argon2id via `argon2-cffi`), added to existing databases at startup; the `user` account gets the hash of `password` if it has none, so the MVP sign-in still works. An unknown username is checked against a dummy hash so response times do not reveal which usernames exist
  - `SESSION_SECRET` from `.env` signs the cookie; without it a random secret is used and a warning is logged (restarts then sign everyone out)
  - `SESSION_HTTPS_ONLY=true` marks the cookie Secure. Opt-in, because the app runs over plain HTTP on localhost and a Secure cookie would not be sent there. `same_site=lax` is set explicitly
  - Rate limiting: 5 failed logins for a username within 15 minutes lock it (429 with a message the login form shows) until the oldest failure expires. Keyed by username, because behind Docker's port mapping every client has the same address; kept in memory, so it resets on restart
  - Checked on the real app: the existing database was upgraded, `user` / `password` still signs in, and the board was unchanged

Notes for working on the project:
- ESLint stays on 10 (9 is no longer supported) with npm `overrides` for the ESLint peer of eslint-config-next's react, import and jsx-a11y plugins, whose latest releases still declare up to ESLint 9. This removes the `npm ci` peer warnings; see `frontend/AGENTS.md` for the two eslint-plugin-react rules that do not work on ESLint 10
- On Windows, run Vitest from an uppercase `C:\` path (PowerShell or cmd); Git Bash's lowercase `c:\` loads Vitest twice and breaks the jest-dom matchers

---

## Part 12 onwards: from MVP to a full project management app (user request)

The user asked to "significantly improve this project: user management, multiple Kanban boards per user, and other features for a comprehensive project management app, testing thoroughly with strong coverage and good integration tests". This lifts the MVP limitations in AGENTS.md (one hardcoded user, one board). Each part keeps the coding standards: simple code, no speculative options, tests with every change.

Roadmap (one part per working session; check off as done):

- [x] Part 12: Accounts and multiple boards
- [x] Part 13: Richer cards (priority, due date, labels) and board search / filter
- [x] Part 14: Editable columns (add, rename, remove, reorder) per board
- [x] Part 15: Board sharing with other users (members can view and edit)
- [x] Part 16: Admin user management (admin role, list users, reset password, delete user)
- [x] Part 17: Board activity log and a dashboard of boards (card counts, overdue cards)
- [x] Part 18: Coverage reporting with thresholds for backend and frontend; review and fill gaps
- [x] Part 19: Card assignees (the people on a board), an assignee filter, "assigned to me" counts, and AI assignment
- [x] Part 20: Live updates: people on a shared board see each other's changes without reloading
- [x] Part 21: Split `backend/app/main.py` into route modules (no behavior change)
- [x] Follow-ups found along the way: changing the password does not sign out other sessions (the cookie only holds the user id); `docs/screenshot.png` shows the old single-board header (both done in Part 13)

### Part 12: Accounts and multiple boards

Decisions:
- Anyone can create an account (`POST /api/register`): username 3-32 characters of lowercase letters, digits, `.`, `_`, `-`; password at least 8 characters. Registering signs you in. The seeded `user` / `password` account stays for the demo and the tests
- The session stores the user id; `current_user` loads the user from the database on every request, so a deleted account is signed out everywhere
- Account settings: change password (needs the current password), delete account (needs the password; deletes the user's boards)
- A user has any number of boards. Each board has a name, its JSON data and a version. Routes move under `/api/boards/{id}`; a board that is not yours is a 404
- New boards get the five standard columns and no cards. A new account starts with one board, "My first board", holding the sample cards
- Existing databases are upgraded at startup: the `boards` table is rebuilt without the one-board-per-user constraint, and the existing board is named "My board"
- Frontend: the selected board is kept in the URL (`?board=<id>`) so a reload stays on it. The header has a board switcher, buttons to create, rename and delete boards, and an account menu

Checklist:
- [x] Backend: schema and migration, account routes, board routes, chat per board
- [x] Frontend: sign up, account settings, board switcher, create / rename / delete board
- [x] Tests: pytest, Vitest and Playwright for the above
- [x] Docs: AGENTS.md files, DATABASE.md, README

Notes:
- Board actions use `window.confirm` for deletes (board and account): no extra dialog component, and Playwright accepts or dismisses it with `page.on("dialog")`
- The column name chips moved out of the header into `KanbanBoard` (a list labelled "Columns"), since the header now belongs to the workspace rather than one board
- Frontend tests that span several requests use an in-memory fake of the API (`src/test/fakeServer.ts`) instead of per-test `fetch` stubs
- Board e2e tests register their own account, so they do not depend on or disturb the shared `user` boards
- Checked on the real app: the existing database (one board at version 48, 10 cards) was upgraded in place; the board kept its id, version and cards and is named "My board". A backup was taken first
- Results: 101 backend tests (including live), 58 Vitest, 26 Playwright, all passing

### Part 13: Richer cards and search / filter

Decisions:
- Cards get three optional fields: `priority` (`low` / `medium` / `high` or null), `dueDate` (`YYYY-MM-DD` or null) and `labels` (up to 10 tags of 1-30 characters, trimmed). They have defaults in the `Card` model, so stored boards stay valid without a data migration. JSON names follow the board's camelCase (`dueDate`, like `cardIds`)
- FastAPI uses one schema per model for requests and responses (`separate_input_output_schemas=False`), so the generated TypeScript `Card` type has `priority` and `dueDate` optional; openapi-typescript makes `labels` (default `[]`) required, which matches what the server always returns
- The AI can set the new fields on `create_card` and `edit_card` (`priority`, `due_date`, `labels`; null = unchanged). New and edited cards are built with `Card.model_validate`, so the AI's values get the same checks as a saved board and invalid ones are skipped and counted in the reply note. The AI is told today's date so it can turn "next Friday" into a date
- Overdue: a due date before today (in the user's time zone), except for cards in the board's last column, which counts as finished
- Search and filters are frontend only and not saved: text (title, details or labels, ignoring case), priority, label. Columns show "matching/total" counts while filtering. Dragging still works on the cards shown
- One `CardForm` component serves adding and editing, so both have every field
- Follow-up from Part 12: `users.session_version` is stored in the session cookie; changing the password increments it, which signs out other sessions while the current session gets the new value. Sessions from before this change sign in once more
- Screenshot retaken from a throwaway container (no volume), so it shows demo data only

Checklist:
- [x] Backend: card fields, operations, AI prompt with today's date, session version
- [x] Frontend: card form fields, card badges, overdue, search and filters
- [x] Tests: pytest (fields, validation, older boards, operations, live AI setting the fields, password change signing out other sessions), Vitest (helpers, form, badges, filters), Playwright (fields, filters, reload)
- [x] Docs and screenshot

Results: 117 backend tests (including live), 73 Vitest, 27 Playwright, all passing.

### Part 14: Editable columns

Decisions:
- The "columns are fixed" rule is gone: `PUT /api/boards/{id}` accepts any valid board. The `Board` model now also checks that column ids are unique and never equal a card id (drag and drop treats both as drop targets, and `moveCard` looks column ids up first)
- A column can only be deleted when it is empty. No extra rule was needed: the existing check that every card is in exactly one column already rejects a board that drops a column with cards. The UI disables the delete button with the hint "Move or delete its cards first", and the AI is told the same
- New columns are added at the end (predictable; they can then be moved). The last column counts as finished work, so moving columns changes which cards can be overdue
- Card colors follow the column's position (`columnColor`), repeating the five standard colors, so the default board looks the same and new columns get a color
- Column controls are arrow buttons (move left / right) and a delete button revealed on hover, like the card icons, rather than drag and drop of columns: simpler, and works with the keyboard
- Columns share the row's width (minimum 240px) and the row scrolls sideways when they do not fit; below `lg` they stack as before
- The AI gains `create_column` (with a temporary id later operations can use), `rename_column` and `delete_column` (empty only). `apply_operations` was restructured into `_apply` (one operation, returns whether it applied) with separate temporary-id maps for cards and columns
- jsdom keeps `var(...)` in inline styles, but `toHaveStyle` reads computed styles and cannot resolve variables, so component tests check `element.style.backgroundColor`

Checklist:
- [x] Backend: validation, column operations, AI prompt
- [x] Frontend: add column, move left / right, delete when empty, colors by position, scrolling layout
- [x] Tests: pytest (column changes accepted, duplicate and clashing ids, non-empty removal, column operations, live AI adding a column and moving a card into it), Vitest (helpers, column UI, colors, overdue after reordering), Playwright (`columns.spec.ts`)
- [x] Docs

Results: 125 backend tests (including live), 85 Vitest, 30 Playwright, all passing.

### Part 15: Board sharing

Decisions:
- `board_members (board_id, user_id)` lists who a board is shared with; the owner stays `boards.user_id`. One role for members: they can open, edit and save the board and use the AI chat on it (anything a board's contents allow). Only the owner can rename, delete or share it; a member can leave
- Access is one SQL condition (`ACCESS` in `db.py`) used by list, get and save, so every read and write path checks it the same way. Owner-only routes call `find_owned_board`: 404 for strangers (a board's existence is not revealed), 403 for members
- Sharing is by username (trimmed and lowercased). An unknown username is a 422 with a message; this does reveal whether a username exists, which sharing by name needs
- Editing together uses the existing versioned saves: a member's save and the owner's save conflict like two tabs (409, the latest board is loaded). No live updates: others' changes show on the next save or reload (a possible later improvement)
- Board summaries and details carry `owner` (a username); the switcher labels shared boards "Name (shared by owner)", and the board bar shows "Share" to the owner and "Members" to members
- Bug found by the tests: `SharePanel` and `KanbanBoard` were siblings keyed by the same board id. React matches keys across all of an element's children, so closing the panel removed the wrong node and the panel stayed on screen (React's "two children with the same key" error, captured with a console.error spy). Fixed with distinct keys (`sharing-<id>`, `board-<id>`). To catch this class of problem, `src/test/setup.ts` now fails any Vitest test that logs a console error (checked with a throwaway test that logs one)

Checklist:
- [x] Backend: members table, access checks, owner-only actions, member routes
- [x] Frontend: shared board labels, share panel (share, remove, leave), owner-only buttons
- [x] Tests: pytest `test_sharing.py`, Vitest sharing tests in `Workspace.test.tsx` (fake API with owners and members), Playwright `sharing.spec.ts` with two browser contexts
- [x] Docs

Results: 144 backend tests (including live), 91 Vitest, 34 Playwright, all passing.

### Part 16: Admin user management

Decisions:
- `users.is_admin` flag; `/api/me` (and register / login) return `is_admin`. Admin routes live under `/api/admin/users` behind a `current_admin` dependency. Because `current_user` reloads the user on every request, role changes take effect at once
- There is always an admin: at startup, if nobody is one, the demo `user` account becomes one (covers new databases and those from before admins), and the API refuses to demote the last admin. Admins cannot delete themselves through the admin routes (account settings does that), so deleting someone else never removes the last admin
- Admins see each user's role, boards owned and join date, but not their boards' contents: managing accounts does not need them
- A password reset bumps the user's session version (signing them out everywhere, as a password change does) and clears any sign-in lockout, so it doubles as "unlock this account"
- The admin panel is a table with inline actions and one status line for results and server messages, matching the account and sharing panels
- Test notes: Playwright's role names match substrings, so "Set password" needs `exact: true` beside "Reset password for ..." buttons; the fake API's timestamp is midday UTC so the shown date is the same in nearly every time zone

Checklist:
- [x] Backend: admin flag and startup rule, admin routes
- [x] Frontend: Admin button and panel
- [x] Tests: pytest `test_admin.py`, Vitest administration tests (fake API with admins), Playwright `admin.spec.ts`
- [x] Docs

Results: 159 backend tests (including live), 101 Vitest, 38 Playwright, all passing.

### Part 17: Activity log and overview

Decisions:
- The frontend saves whole boards, so there are no per-change events to log. Instead `describe_changes(old, new)` compares the board before and after each save (and each AI change) by card and column id and writes sentences: columns added / renamed / deleted / reordered, cards added / moved / edited / deleted, and cards reordered within a column. It is a pure function with its own unit tests. A save that changes nothing logs nothing. The board compared against is the one read just before the versioned save, which is exactly the board being replaced when the save succeeds
- Board-level events are logged by their routes: created (including a new account's first board), renamed (only when the name changes), shared, member removed, member left
- `board_activity` keeps the username as text so entries survive the account being deleted; AI changes are flagged `via_ai` and shown "with AI". Each board keeps its newest 200 entries; the API returns the newest 50. Deleting a board deletes its log
- The overview reuses `GET /api/boards`: each summary now has `cards`, `done` (cards in the last column) and `overdue` (past due by the server's date, not in the last column). Computing overdue on the server uses the server's date, which can differ from the user's by a day around midnight; the board itself still uses the user's local date
- Both are panels like Sharing and Users (buttons in the board bar), not new pages: the app stays one page with the board in the URL
- The activity panel loads when opened and has a Refresh button rather than live updates

Checklist:
- [x] Backend: `describe_changes`, `board_stats`, activity table and route, stats on summaries
- [x] Frontend: Activity panel, Overview panel
- [x] Tests: pytest `test_activity.py`, Vitest activity and overview tests, Playwright `activity.spec.ts` (own log, a member's change in the owner's log, overview)
- [x] Docs

Results: 178 backend tests (including live), 107 Vitest, 41 Playwright, all passing.

### Part 18: Coverage

Decisions:
- Backend: `pytest-cov` (dev dependency). `pytest --cov` measures the `app` package with branch coverage and fails below 98% (`[tool.coverage.report] fail_under`). Coverage is not on by default (`addopts`), because then running one test file would fail the threshold. The `__main__` block of `openapi.py` is excluded (a command-line entry point)
- Frontend: `npm run test:coverage` (v8) over every source file (so untested files count as 0%), excluding tests, `src/test/`, the generated `api-types.ts` and the root `layout.tsx` (only Next.js renders it; every e2e test does). Thresholds: 95% statements, lines and functions, 90% branches. Both thresholds were checked to fail when not met
- Starting point: backend 99% lines; frontend 95.7% lines / 90.9% branches. Now: backend 99.9% (lines and branches), frontend 98.7% lines / 94.4% branches
- Gaps filled: `ai.ask` and the chat's 409 when the board changes during the AI's final save (backend); moveCard edge cases, an AI board arriving while a change is unsaved, whitespace-only titles and usernames, and the error paths of the sharing, activity and admin panels (frontend)
- Unreachable checks removed rather than tested, per the coding standards: two in `moveCard` (columns that `findColumnId` already found; an over-card that is in its column by construction) and the chat sidebar's guard against sending a blank message or while waiting (the Send button is disabled then, and Enter cannot submit a form whose submit button is disabled). The one uncovered backend branch is `match` falling through all seven operation types, which the `Literal` type rules out
- Left to e2e: dragging cards (`handleDragStart` / `handleDragEnd`, the drag preview) needs real pointer geometry that jsdom lacks; the Playwright drag tests cover it
- Bug found while measuring: two backend tests left SQLite connections open (`with sqlite3.connect(...)` commits but does not close), reported as `ResourceWarning` only. Test connections now use `closing(sqlite3.connect(path, autocommit=True))`, and pytest's `filterwarnings` turns `ResourceWarning` into a failure (checked: the old `test_board.py` fails with it). The fake AI client moved to `conftest.py` so the chat and activity tests share it

Results: 174 backend tests (180 with live), 116 Vitest, 41 Playwright, all passing; coverage 99.87% backend, 98.69% lines frontend.

### Part 19: Card assignees

Decisions:
- Cards have an optional `assignee` (a username), with a default like the other optional card fields, so stored boards stay valid. A save checks only the username format, not membership: otherwise removing a member would make every later save of a board with their cards fail. Their name stays on the card (and in the card form's choices) until someone reassigns it
- Board details now include `members`, so the frontend knows the people on the board (owner first). The sharing panel passes member changes to the open board, so a newly shared person can be assigned at once
- The AI is told the people on the board (a line before the board JSON) and can set `assignee` on create and edit; an empty string unassigns. `apply_operations` takes `people` and skips an assignment to anyone else (counted in the reply note), since the model writes free text
- `BoardPeopleContext` carries the people and the signed-in user to the card form and filters instead of passing props through columns and cards
- The assignee filter offers Anyone, each person ("user (me)" for yourself) and Unassigned; `UNASSIGNED` is "(unassigned)", which can never be a username. Search also matches the assignee
- Board summaries count `mine` (the user's assigned cards not in the last column), shown in the overview as "N assigned to you"
- Also: ESLint ignores `coverage/` (the HTML coverage report triggered warnings)

Checklist:
- [x] Backend: card field, members in details, AI people and assignment, `mine`
- [x] Frontend: assignee in the card form and on cards, filter, overview count
- [x] Tests: pytest (format, operations, AI people, former members, `mine`; live assignment), Vitest (filter logic, form, former member, filter UI, sharing updates, overview), Playwright (owner assigns, member filters by "me")
- [x] Docs

Results: 190 backend tests (including live, 99.87% coverage), 122 Vitest (98.7% lines), 42 Playwright, all passing.

### Part 20: Live updates

Decisions:
- Polling, not WebSockets or server-sent events: an open board fetches itself every 5 seconds (`POLL_INTERVAL_MS`) and shows the server's board when its version is newer. The version numbers already say whether anything changed, and no server changes or long-lived connections are needed, which suits one container serving a few people
- A check is skipped while the tab is hidden or when showing the server's board could lose work here: a save queued or in flight (that save will hit a 409 and load the latest board anyway), a card being dragged, or a column title typed but not yet saved. A failed check is ignored and retried on the next tick
- Only the board's contents update live; the board list, names and members still refresh when a board is opened (or the page reloaded)
- Bug fixed on the way: cancelling a drag with Escape never ran `handleDragEnd`, so drag state was left set; `onDragCancel` now clears it (and the poll pause with it)
- The existing "stale tab" e2e test blocks the second tab's checks with `page.route`, otherwise polling could bring that tab up to date before it saves and the 409 would not happen
- Unit tests use Vitest fake timers (`shouldAdvanceTime`, so user events and `waitFor` still run) and advance one interval at a time

Checklist:
- [x] Polling with the pauses above, drag cancel handled
- [x] Tests: Vitest (seven live-update cases), Playwright (an owner sees a member's edit without reloading; stale-tab test kept deterministic)
- [x] Docs

Results: 190 backend tests (unchanged), 129 Vitest (98.3% lines, 94.9% branches), 43 Playwright, all passing.

### Part 21: Route modules

Decisions:
- `main.py` had grown to 494 lines covering accounts, admin, boards, sharing, activity and chat. It now only builds the app (middleware, startup, health check, routers, static files: 45 lines). Each area is an `APIRouter` in `app/routes/` (`accounts.py`, `admin.py`, `boards.py`, `chat.py`), and the dependencies they share (signed-in user, admin, board lookups) are in `app/access.py`
- The code was moved verbatim by a script that cut each block out of `main.py` by its first and last lines, so nothing was retyped; only imports, `@app` to `@router`, and section comments to module docstrings changed
- No behavior change, checked three ways: all 190 backend tests (including live) pass unchanged except one import (`ACTIVITY_SHOWN` now comes from `app.routes.boards`); the committed `openapi.json` still matches the app exactly (`test_openapi.py`), so every route, model and operation id is the same; and `ruff check --select F` (run once with `uvx`, not added to the project) finds no unused or undefined names
- No router tags or prefixes were added, since those would change the OpenAPI schema and the generated TypeScript types for no benefit

Results: 190 backend tests (99.88% coverage), unchanged frontend (129 Vitest, 43 Playwright).
