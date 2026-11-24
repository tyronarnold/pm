from contextlib import asynccontextmanager
from datetime import date
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, StringConstraints
from starlette.middleware.sessions import SessionMiddleware

from app import ai, auth, db
from app.board import DEFAULT_BOARD, EMPTY_BOARD, Board, apply_operations, board_stats, describe_changes

STATIC_DIR = Path(__file__).parent.parent / "static"

# The demo account, created at startup if missing. Its password is only used to set the
# stored hash the first time (or for databases created before passwords were hashed).
DEMO_USERNAME = "user"
DEMO_PASSWORD = "password"
FIRST_BOARD_NAME = "My first board"


def create_account(username: str, password: str) -> db.User | None:
    """Create a user with a first board holding the sample cards; None if the username is taken."""
    user_id = db.create_user(username, auth.hash_password(password))
    if user_id is None:
        return None
    board_id = db.create_board(user_id, FIRST_BOARD_NAME, DEFAULT_BOARD.model_dump_json())
    db.add_activity(board_id, username, ["created the board"])
    return db.get_user(user_id)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    if create_account(DEMO_USERNAME, DEMO_PASSWORD) is None:
        db.ensure_password(DEMO_USERNAME, auth.hash_password(DEMO_PASSWORD))
    # There is always someone who can manage users: if nobody is an admin, the demo account is.
    db.ensure_an_admin(DEMO_USERNAME)
    yield


# One schema per model for requests and responses, so fields with defaults (such as a
# card's optional priority) are optional in the generated TypeScript types too.
app = FastAPI(lifespan=lifespan, separate_input_output_schemas=False)
app.add_middleware(
    SessionMiddleware,
    secret_key=auth.session_secret(),
    https_only=auth.https_only(),
    same_site="lax",
)


def current_user(request: Request) -> db.User:
    """The signed-in user, loaded on every request so a deleted account, or a session from
    before a password change, is signed out."""
    user_id = request.session.get("user_id")
    user = db.get_user(user_id) if user_id else None
    if user is None or request.session.get("session_version") != user.session_version:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


CurrentUser = Annotated[db.User, Depends(current_user)]


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Accounts

Username = Annotated[str, Field(pattern=r"^[a-z0-9._-]{3,32}$")]
NewPassword = Annotated[str, Field(min_length=8, max_length=128)]


class Credentials(BaseModel):
    username: str
    password: str


class NewAccount(BaseModel):
    username: Username
    password: NewPassword


class PasswordChange(BaseModel):
    current_password: str
    new_password: NewPassword


class PasswordConfirmation(BaseModel):
    password: str


class Account(BaseModel):
    username: str
    is_admin: bool


def account(user: db.User) -> Account:
    return Account(username=user.username, is_admin=user.is_admin)


def sign_in(request: Request, user: db.User) -> Account:
    request.session.clear()
    request.session["user_id"] = user.id
    request.session["session_version"] = user.session_version
    return account(user)


def check_password(user: db.User, password: str) -> None:
    if not auth.verify_password(db.get_password_hash(user.id), password):
        raise HTTPException(status_code=403, detail="That password is not correct.")


@app.post(
    "/api/register",
    status_code=201,
    responses={409: {"description": "Username taken"}, 422: {"description": "Invalid username or password"}},
)
def register(account: NewAccount, request: Request) -> Account:
    """Create an account and sign in to it."""
    user = create_account(account.username, account.password)
    if user is None:
        raise HTTPException(status_code=409, detail="That username is already taken.")
    return sign_in(request, user)


@app.post(
    "/api/login",
    responses={
        401: {"description": "Wrong username or password"},
        429: {"description": "Too many failed attempts for this username"},
    },
)
def login(credentials: Credentials, request: Request) -> Account:
    username = credentials.username
    if auth.is_locked_out(username):
        raise HTTPException(
            status_code=429,
            detail="Too many failed sign-in attempts. Please wait 15 minutes and try again.",
        )
    found = db.find_user(username)
    if not auth.verify_password(found[1] if found else None, credentials.password):
        auth.record_failure(username)
        raise HTTPException(status_code=401, detail="Invalid username or password.")
    auth.clear_failures(username)
    return sign_in(request, found[0])


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@app.get("/api/me")
def me(user: CurrentUser) -> Account:
    return account(user)


@app.put("/api/me/password", responses={403: {"description": "Current password is wrong"}})
def change_password(change: PasswordChange, request: Request, user: CurrentUser):
    """Change the password. Other sessions are signed out; this one stays signed in."""
    check_password(user, change.current_password)
    request.session["session_version"] = db.set_password_hash(user.id, auth.hash_password(change.new_password))
    return {"status": "ok"}


@app.delete("/api/me", status_code=204, responses={403: {"description": "Password is wrong"}})
def delete_account(confirmation: PasswordConfirmation, request: Request, user: CurrentUser):
    """Delete the account and all its boards, and sign out."""
    check_password(user, confirmation.password)
    db.delete_user(user.id)
    request.session.clear()
    return Response(status_code=204)


# Administration: admins see every user, change who is an admin, reset passwords and
# delete users. There is always at least one admin.


def current_admin(user: CurrentUser) -> db.User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Only admins can do that.")
    return user


CurrentAdmin = Annotated[db.User, Depends(current_admin)]


class UserInfo(BaseModel):
    username: str
    is_admin: bool
    created_at: str
    boards: int  # boards they own


class RoleChange(BaseModel):
    is_admin: bool


class PasswordReset(BaseModel):
    new_password: NewPassword


ADMIN_ONLY = {403: {"description": "Not an admin"}}
ADMIN_USER = {**ADMIN_ONLY, 404: {"description": "No such user"}}


def find_named_user(username: str) -> db.User:
    found = db.find_user(username)
    if found is None:
        raise HTTPException(status_code=404, detail="No such user.")
    return found[0]


def user_info(username: str) -> UserInfo:
    return next(UserInfo(**row._asdict()) for row in db.list_users() if row.username == username)


@app.get("/api/admin/users", responses=ADMIN_ONLY)
def list_users(admin: CurrentAdmin) -> list[UserInfo]:
    """Every user, sorted by username."""
    return [UserInfo(**row._asdict()) for row in db.list_users()]


@app.patch("/api/admin/users/{username}", responses={**ADMIN_USER, 409: {"description": "The last admin"}})
def set_role(username: str, change: RoleChange, admin: CurrentAdmin) -> UserInfo:
    """Make the user an admin, or not. The last admin cannot be removed."""
    user = find_named_user(username)
    if user.is_admin and not change.is_admin and db.count_admins() == 1:
        raise HTTPException(status_code=409, detail="There must be at least one admin.")
    db.set_admin(user.id, change.is_admin)
    return user_info(username)


@app.put("/api/admin/users/{username}/password", responses=ADMIN_USER)
def reset_password(username: str, reset: PasswordReset, request: Request, admin: CurrentAdmin):
    """Set a new password for the user: signs them out everywhere and lifts a sign-in lockout."""
    user = find_named_user(username)
    session_version = db.set_password_hash(user.id, auth.hash_password(reset.new_password))
    if user.id == admin.id:
        request.session["session_version"] = session_version  # stay signed in here
    auth.clear_failures(username)
    return {"status": "ok"}


@app.delete(
    "/api/admin/users/{username}",
    status_code=204,
    responses={**ADMIN_USER, 409: {"description": "Yourself (use DELETE /api/me)"}},
)
def delete_user(username: str, admin: CurrentAdmin):
    """Delete the user and their boards. Admins delete their own account from account settings."""
    user = find_named_user(username)
    if user.id == admin.id:
        raise HTTPException(status_code=409, detail="Delete your own account from your account settings.")
    db.delete_user(user.id)
    return Response(status_code=204)


# Boards

BoardNameText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class BoardName(BaseModel):
    name: BoardNameText


class BoardSummary(BaseModel):
    id: int
    name: str
    updated_at: str
    owner: str  # username; boards shared with the user have someone else's
    cards: int
    done: int  # cards in the last column
    overdue: int  # past their due date (by the server's date), not in the last column


class BoardDetail(BaseModel):
    id: int
    name: str
    owner: str
    version: int
    board: Board


class NewMember(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True)]


class VersionedBoard(BaseModel):
    """A board plus its version. The version goes up by one on every save."""

    version: int
    board: Board


NOT_FOUND = {404: {"description": "No such board (or not shared with you)"}}
OWNER_ONLY = {**NOT_FOUND, 403: {"description": "Only the board's owner can do this"}}


def find_board(user: db.User, board_id: int) -> db.BoardRow:
    """The board, if the user owns it or is a member; 404 otherwise."""
    row = db.get_board(user.id, board_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Board not found")
    return row


def find_owned_board(user: db.User, board_id: int) -> db.BoardRow:
    """The board, if the user owns it; 403 for a member, 404 for anyone else."""
    row = find_board(user, board_id)
    if row.owner != user.username:
        raise HTTPException(status_code=403, detail="Only the board's owner can do that.")
    return row


def summary(row: db.BoardRow) -> BoardSummary:
    stats = board_stats(Board.model_validate_json(row.data), date.today())
    return BoardSummary(id=row.id, name=row.name, updated_at=row.updated_at, owner=row.owner, **stats._asdict())


def detail(row: db.BoardRow) -> BoardDetail:
    return BoardDetail(
        id=row.id, name=row.name, owner=row.owner, version=row.version, board=Board.model_validate_json(row.data)
    )


@app.get("/api/boards")
def list_boards(user: CurrentUser) -> list[BoardSummary]:
    """The boards the user owns or that are shared with them, oldest first."""
    return [summary(row) for row in db.list_boards(user.id)]


@app.post("/api/boards", status_code=201)
def create_board(new: BoardName, user: CurrentUser) -> BoardDetail:
    """Create a board with the standard columns and no cards."""
    board_id = db.create_board(user.id, new.name, EMPTY_BOARD.model_dump_json())
    db.add_activity(board_id, user.username, ["created the board"])
    return detail(find_board(user, board_id))


@app.get("/api/boards/{board_id}", responses=NOT_FOUND)
def get_board(board_id: int, user: CurrentUser) -> BoardDetail:
    return detail(find_board(user, board_id))


@app.patch("/api/boards/{board_id}", responses=OWNER_ONLY)
def rename_board(board_id: int, new: BoardName, user: CurrentUser) -> BoardSummary:
    old_name = find_owned_board(user, board_id).name
    db.rename_board(user.id, board_id, new.name)
    if new.name != old_name:
        db.add_activity(board_id, user.username, [f'renamed the board from "{old_name}" to "{new.name}"'])
    return summary(find_board(user, board_id))


@app.delete("/api/boards/{board_id}", status_code=204, responses=OWNER_ONLY)
def delete_board(board_id: int, user: CurrentUser):
    find_owned_board(user, board_id)
    db.delete_board(user.id, board_id)
    return Response(status_code=204)


@app.get("/api/boards/{board_id}/members", responses=NOT_FOUND)
def list_members(board_id: int, user: CurrentUser) -> list[str]:
    """Usernames the board is shared with (not including the owner)."""
    find_board(user, board_id)
    return db.list_members(board_id)


@app.post(
    "/api/boards/{board_id}/members",
    status_code=201,
    responses={**OWNER_ONLY, 409: {"description": "Already a member, or the owner"}, 422: {"description": "No such user"}},
)
def add_member(board_id: int, new: NewMember, user: CurrentUser) -> list[str]:
    """Share the board with another user; returns the members."""
    find_owned_board(user, board_id)
    found = db.find_user(new.username)
    if found is None:
        raise HTTPException(status_code=422, detail=f'There is no user called "{new.username}".')
    member = found[0]
    if member.id == user.id:
        raise HTTPException(status_code=409, detail="You own this board already.")
    if not db.add_member(board_id, member.id):
        raise HTTPException(status_code=409, detail=f"{member.username} is already a member.")
    db.add_activity(board_id, user.username, [f"shared the board with {member.username}"])
    return db.list_members(board_id)


@app.delete("/api/boards/{board_id}/members/{username}", status_code=204, responses=OWNER_ONLY)
def remove_member(board_id: int, username: str, user: CurrentUser):
    """The owner removes a member, or a member leaves the board."""
    row = find_board(user, board_id)
    if row.owner != user.username and username != user.username:
        raise HTTPException(status_code=403, detail="Only the board's owner can do that.")
    found = db.find_user(username)
    if found is None or not db.remove_member(board_id, found[0].id):
        raise HTTPException(status_code=404, detail=f"{username} is not a member of this board.")
    message = "left the board" if username == user.username else f"removed {username} from the board"
    db.add_activity(board_id, user.username, [message])
    return Response(status_code=204)


class ActivityEntry(BaseModel):
    username: str
    message: str  # what they did, such as 'moved "Launch" from "Backlog" to "Done"'
    via_ai: bool  # made by the AI assistant at the user's request
    created_at: str


ACTIVITY_SHOWN = 50


@app.get("/api/boards/{board_id}/activity", responses=NOT_FOUND)
def list_activity(board_id: int, user: CurrentUser) -> list[ActivityEntry]:
    """The board's latest changes, newest first (owner and members)."""
    find_board(user, board_id)
    return [ActivityEntry(**entry._asdict()) for entry in db.list_activity(board_id, ACTIVITY_SHOWN)]


@app.put(
    "/api/boards/{board_id}",
    responses={**NOT_FOUND, 409: {"description": "Board changed since `version`; body has the current board"}},
)
def save_board(board_id: int, update: VersionedBoard, user: CurrentUser) -> VersionedBoard:
    """Save the board if it is still at `update.version` (optimistic concurrency)."""
    # The save only succeeds if the board is still at the version read here, so this is
    # exactly the board being replaced, which the activity log compares against.
    before = detail(find_board(user, board_id)).board
    version = db.update_board(user.id, board_id, update.board.model_dump_json(), update.version)
    if version is None:
        current = detail(find_board(user, board_id))
        return JSONResponse(
            status_code=409,
            content={"detail": "Board changed since this version", "version": current.version,
                     "board": current.board.model_dump()},
        )
    db.add_activity(board_id, user.username, describe_changes(before, update.board))
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
        " that does not exist, had no title, had an invalid value, or was a column that still had cards.)"
    )


@app.post(
    "/api/boards/{board_id}/chat",
    responses={**NOT_FOUND, 502: {"description": "The AI call failed; `detail` is a message for the user"}},
)
def chat(board_id: int, request: ChatRequest, user: CurrentUser) -> ChatResponse:
    try:
        result = ai.chat(detail(find_board(user, board_id)).board, request.history, request.message)
    except ai.AIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    # The user may have saved changes while the AI was working, so apply its
    # operations to the latest saved board rather than the one it was shown.
    latest = detail(find_board(user, board_id))
    updated, skipped = apply_operations(latest.board, result.operations)
    reply = result.reply + (skipped_note(len(skipped)) if skipped else "")
    if updated == latest.board:
        return ChatResponse(reply=reply, board=None, version=latest.version)
    version = db.update_board(user.id, board_id, updated.model_dump_json(), latest.version)
    if version is None:
        raise HTTPException(
            status_code=409, detail="Your board changed while the AI was working. Please try again."
        )
    db.add_activity(board_id, user.username, describe_changes(latest.board, updated), via_ai=True)
    return ChatResponse(reply=reply, board=updated, version=version)


app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
