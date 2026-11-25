"""Accounts: register, sign in and out, the signed-in user, password changes, account deletion."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app import auth, db
from app.access import CurrentUser
from app.board import DEFAULT_BOARD

router = APIRouter()

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


@router.post(
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


@router.post(
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


@router.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"status": "ok"}


@router.get("/api/me")
def me(user: CurrentUser) -> Account:
    return account(user)


@router.put("/api/me/password", responses={403: {"description": "Current password is wrong"}})
def change_password(change: PasswordChange, request: Request, user: CurrentUser):
    """Change the password. Other sessions are signed out; this one stays signed in."""
    check_password(user, change.current_password)
    request.session["session_version"] = db.set_password_hash(user.id, auth.hash_password(change.new_password))
    return {"status": "ok"}


@router.delete("/api/me", status_code=204, responses={403: {"description": "Password is wrong"}})
def delete_account(confirmation: PasswordConfirmation, request: Request, user: CurrentUser):
    """Delete the account and all its boards, and sign out."""
    check_password(user, confirmation.password)
    db.delete_user(user.id)
    request.session.clear()
    return Response(status_code=204)
