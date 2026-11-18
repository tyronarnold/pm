import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from app import ai, db
from app.board import DEFAULT_BOARD, Board, apply_operations, column_ids

STATIC_DIR = Path(__file__).parent.parent / "static"

USERNAME = "user"
PASSWORD = "password"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    db.add_user(USERNAME)
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(SessionMiddleware, secret_key=secrets.token_hex(32))


class Credentials(BaseModel):
    username: str
    password: str


def current_user(request: Request) -> str:
    username = request.session.get("username")
    if not username:
        raise HTTPException(status_code=401, detail="Not signed in")
    return username


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/login")
def login(credentials: Credentials, request: Request):
    if credentials.username != USERNAME or credentials.password != PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session["username"] = credentials.username
    return {"username": credentials.username}


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@app.get("/api/me")
def me(username: str = Depends(current_user)):
    return {"username": username}


class VersionedBoard(BaseModel):
    """A board plus its version. The version goes up by one on every save."""

    version: int
    board: Board


def load_board(username: str) -> VersionedBoard:
    row = db.get_board(username)
    if row is None:
        db.create_board(username, DEFAULT_BOARD.model_dump_json())
        return VersionedBoard(version=1, board=DEFAULT_BOARD)
    data, version = row
    return VersionedBoard(version=version, board=Board.model_validate_json(data))


@app.get("/api/board")
def get_board(username: str = Depends(current_user)) -> VersionedBoard:
    return load_board(username)


@app.put("/api/board", responses={409: {"description": "Board changed since `version`; body has the current board"}})
def put_board(update: VersionedBoard, username: str = Depends(current_user)):
    """Save the board if it is still at `update.version` (optimistic concurrency)."""
    if column_ids(update.board) != column_ids(load_board(username).board):
        raise HTTPException(status_code=422, detail="Columns cannot be added, removed or reordered")
    version = db.update_board(username, update.board.model_dump_json(), update.version)
    if version is None:
        current = load_board(username)
        return JSONResponse(
            status_code=409,
            content={"detail": "Board changed since this version", **current.model_dump()},
        )
    return VersionedBoard(version=version, board=update.board)


class ChatRequest(BaseModel):
    message: str
    history: list[ai.ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str
    board: Board | None  # null when the AI made no changes
    version: int


@app.post("/api/chat")
def chat(request: ChatRequest, username: str = Depends(current_user)) -> ChatResponse:
    result = ai.chat(load_board(username).board, request.history, request.message)
    # The user may have saved changes while the AI was working, so apply its
    # operations to the latest saved board rather than the one it was shown.
    latest = load_board(username)
    updated = apply_operations(latest.board, result.operations)
    if updated == latest.board:
        return ChatResponse(reply=result.reply, board=None, version=latest.version)
    version = db.update_board(username, updated.model_dump_json(), latest.version)
    if version is None:
        raise HTTPException(status_code=409, detail="Board changed while the AI was working; try again")
    return ChatResponse(reply=result.reply, board=updated, version=version)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
