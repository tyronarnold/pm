FROM node:26-slim AS frontend

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# The backend on its own. `npm run api:types` builds only this stage (--target backend)
# to write openapi.json, so frontend type errors cannot block regenerating the types.
FROM python:3.15-slim AS backend

COPY --from=ghcr.io/astral-sh/uv:0.13.9 /uv /uvx /bin/

WORKDIR /app

COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen

COPY backend/ ./
# Filled with the frontend in the final stage; empty here so the app can start without it.
RUN mkdir -p static

FROM backend

COPY --from=frontend /frontend/out ./static

EXPOSE 8000
CMD ["uv", "run", "--no-sync", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
