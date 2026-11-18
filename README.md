# Kanban Studio

Project management app: Next.js frontend, FastAPI backend, SQLite, AI chat via OpenRouter. Runs in one Docker container.

![Kanban Studio board with the AI Assistant sidebar](docs/screenshot.png)

Requires Docker and a `.env` file in the repo root containing `OPENROUTER_API_KEY`.

## Run

Mac / Linux:

```
./scripts/start.sh
./scripts/stop.sh
```

Windows:

```
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
```

The app runs at http://localhost:8000.

## Test

Backend (in the container image built by the start script):

```
docker run --rm pm uv run --no-sync pytest
```

Add `--env-file .env` after `--rm` to also run the tests that call OpenRouter (otherwise they are skipped). `pytest -m live` runs only those.

Frontend (from `frontend/`, after `npm install`). The e2e tests build the image and run their own throwaway container on port 8001, so your board on port 8000 is never touched; the chat test calls the real AI:

```
npm run test:unit
npm run test:e2e
```
