from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

from app import ai, auth, db
from app.board import DEFAULT_BOARD, Board, apply_operations, column_ids

STATIC_DIR = Path(__file__).parent.parent / "static"

# The MVP's single account. Its password is only used to set the stored hash the
# first time (or for databases created before passwords were hashed).
USERNAME = "user"
DEFAULT_PASSWORD = "password"


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    db.add_user(USERNAME, auth.hash_password(DEFAULT_PASSWORD))
    yield


app = FastAPI(lifespan=lifespan)
app.add_middleware(
    SessionMiddleware,
    secret_key=auth.session_secret(),
    https_only=auth.https_only(),
    same_site="lax",
)


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


@app.post(
    "/api/login",
    responses={
        401: {"description": "Wrong username or password"},
        429: {"description": "Too many failed attempts for this username"},
    },
)
def login(credentials: Credentials, request: Request):
    username = credentials.username
    if auth.is_locked_out(username):
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Please wait 15 minutes and try again.",
        )
    if not auth.verify_password(db.get_password_hash(username), credentials.password):
        auth.record_failure(username)
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    auth.clear_failures(username)
    request.session["username"] = username
    return {"username": username}


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


def skipped_note(count: int) -> str:
    """Told to the user, and to the AI through the chat history, when changes could not be applied."""
    changes = "1 requested change" if count == 1 else f"{count} requested changes"
    return (
        f"\n\n(Note: {changes} could not be applied, because they referred to a card or column"
        " that does not exist or had no title.)"
    )


@app.post("/api/chat", responses={502: {"description": "The AI call failed; `detail` is a message for the user"}})
def chat(request: ChatRequest, username: str = Depends(current_user)) -> ChatResponse:
    try:
        result = ai.chat(load_board(username).board, request.history, request.message)
    except ai.AIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    # The user may have saved changes while the AI was working, so apply its
    # operations to the latest saved board rather than the one it was shown.
    latest = load_board(username)
    updated, skipped = apply_operations(latest.board, result.operations)
    reply = result.reply + (skipped_note(len(skipped)) if skipped else "")
    if updated == latest.board:
        return ChatResponse(reply=reply, board=None, version=latest.version)
    version = db.update_board(username, updated.model_dump_json(), latest.version)
    if version is None:
        raise HTTPException(
            status_code=409, detail="Your board changed while the AI was working. Please try again."
        )
    return ChatResponse(reply=reply, board=updated, version=version)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
