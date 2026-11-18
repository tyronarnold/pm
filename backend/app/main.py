import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
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


def load_board(username: str) -> Board:
    data = db.get_board(username)
    if data is None:
        db.save_board(username, DEFAULT_BOARD.model_dump_json())
        return DEFAULT_BOARD
    return Board.model_validate_json(data)


@app.get("/api/board")
def get_board(username: str = Depends(current_user)) -> Board:
    return load_board(username)


@app.put("/api/board")
def put_board(board: Board, username: str = Depends(current_user)) -> Board:
    if column_ids(board) != column_ids(load_board(username)):
        raise HTTPException(status_code=422, detail="Columns cannot be added, removed or reordered")
    db.save_board(username, board.model_dump_json())
    return board


class ChatRequest(BaseModel):
    message: str
    history: list[ai.ChatMessage] = []


class ChatResponse(BaseModel):
    reply: str
    board: Board


@app.post("/api/chat")
def chat(request: ChatRequest, username: str = Depends(current_user)) -> ChatResponse:
    board = load_board(username)
    result = ai.chat(board, request.history, request.message)
    updated = apply_operations(board, result.operations)
    if updated != board:
        db.save_board(username, updated.model_dump_json())
    return ChatResponse(reply=result.reply, board=updated)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
