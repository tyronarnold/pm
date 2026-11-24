# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kanban project management MVP: Next.js static export served by a FastAPI backend, SQLite, AI chat via OpenRouter, all in one Docker container on http://localhost:8000. Sign in as `user` / `password`.

## Read first

- `AGENTS.md` (root): business requirements, technical decisions, color scheme and coding standards. The standards are binding: keep it simple, no over-engineering or unnecessary defensive code, no extra features, minimal README, never use emojis, and find the root cause with evidence before fixing anything.
- `docs/PLAN.md`: the plan and decision log. Check off items and record decisions there when doing planned work.
- `backend/AGENTS.md`, `frontend/AGENTS.md`, `scripts/AGENTS.md`: detailed per-file and per-route reference. Read the relevant one before changing code in that directory, and update it when the code changes.
- `docs/DATABASE.md`, `docs/board.schema.json`: storage design and the board JSON shape.

## Commands

The backend only runs inside the container (uv is not installed on the host, and `backend/static/` is filled by the Docker build). Backend code is copied into the image, so rebuild after changing it.

```
./scripts/start.sh | scripts\start.ps1     build the `pm` image and (re)start the container on port 8000
./scripts/stop.sh  | scripts\stop.ps1      remove the container
docker build -t pm .                       build the image without starting it
(Windows may block unsigned scripts: powershell -ExecutionPolicy Bypass -File scripts\start.ps1)

docker run --rm pm uv run --no-sync pytest                                 backend tests (live AI tests skipped)
docker run --rm --env-file .env pm uv run --no-sync pytest                 including live OpenRouter tests
docker run --rm pm uv run --no-sync pytest tests/test_board.py -k <name>  a single backend test
```

Frontend, from `frontend/` (after `npm install`):

```
npm run lint
npm run build                               static export to out/ (also type checks)
npm run test:unit                           vitest
npx vitest run src/lib/kanban.test.ts -t "<name>"     a single unit test
npm run test:e2e                            playwright (builds the image, runs a throwaway pm-test container on port 8001)
npx playwright test tests/kanban.spec.ts -g "<name>"  a single e2e test
npm run api:types                           regenerate backend/openapi.json and src/lib/api-types.ts (needs Docker)
```

Changing Python dependencies: `docker run --rm -v "$PWD/backend:/work" -w /work ghcr.io/astral-sh/uv:0.13.9-python3.15-trixie-slim uv add <package>`.

## Architecture

- **One board per user, stored as a JSON blob** in `boards.data` with a `version` integer. The board shape (`columns` with `id`, `title`, `cardIds`; `cards` keyed by id) is defined once by the Pydantic `Board` model in `backend/app/board.py`. Columns are fixed: only titles can change, and `PUT /api/board` rejects changed column ids.
- **Types flow backend to frontend.** `backend/openapi.json` (committed) is generated from the FastAPI app, and `frontend/src/lib/api-types.ts` (generated, never edit by hand) from that. After changing a Pydantic model or route, run `npm run api:types` and commit both files; `backend/tests/test_openapi.py` fails if `openapi.json` is stale, and the frontend type check fails if the frontend no longer fits.
- **Optimistic concurrency.** Every save sends the version it is based on; the backend saves only if the version still matches and returns 409 with the current board otherwise. In `KanbanBoard.tsx` every change updates state and queues a whole-board save; saves run one at a time, each using the version returned by the previous one. A 409 replaces local state with the server's board.
- **AI edits are operations, not board replacements.** `POST /api/chat` sends the system prompt, board JSON, history and message to OpenRouter (`backend/app/ai.py`, Structured Outputs into `{reply, operations}`). `apply_operations` in `board.py` applies `create_card` / `edit_card` / `move_card` / `delete_card` to the *latest saved* board (the user may have saved meanwhile), skipping invalid ones and noting the count in the reply. The backend saves the result, so the frontend replaces its board with the returned one without saving again. Chat history lives only in browser state.
- **Auth:** Starlette `SessionMiddleware` signed cookie; argon2 hashes in `users.password_hash`; in-memory per-username login lockout. Every protected route depends on `current_user` in `main.py`. The static site is mounted at `/` last so `/api` routes take priority.

## Testing notes

- Backend tests use a temporary `DB_PATH` per test (`conftest.py`); use `with TestClient(app) as client` so startup runs. AI tests replace `ai.client` with a fake; real OpenRouter tests are marked `live`.
- e2e tests share one `user` board, so Playwright runs with one worker and each test resets the board via `tests/helpers.ts`. The chat e2e test calls the real AI.
- On Windows, run Vitest from PowerShell or cmd (uppercase `C:\` path). From Git Bash the lowercase `c:\` path loads Vitest twice and the jest-dom matchers fail with "Invalid Chai property".
- Next.js renders a hidden route announcer with `role="alert"`, so find messages in e2e tests by text. Use `getByLabel("Message", { exact: true })` in Playwright.
