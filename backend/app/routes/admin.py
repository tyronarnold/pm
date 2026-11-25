"""Administration: admins see every user, change who is an admin, reset passwords and
delete users. There is always at least one admin."""

from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel

from app import auth, db
from app.access import CurrentAdmin
from app.routes.accounts import NewPassword

router = APIRouter()


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


@router.get("/api/admin/users", responses=ADMIN_ONLY)
def list_users(admin: CurrentAdmin) -> list[UserInfo]:
    """Every user, sorted by username."""
    return [UserInfo(**row._asdict()) for row in db.list_users()]


@router.patch("/api/admin/users/{username}", responses={**ADMIN_USER, 409: {"description": "The last admin"}})
def set_role(username: str, change: RoleChange, admin: CurrentAdmin) -> UserInfo:
    """Make the user an admin, or not. The last admin cannot be removed."""
    user = find_named_user(username)
    if user.is_admin and not change.is_admin and db.count_admins() == 1:
        raise HTTPException(status_code=409, detail="There must be at least one admin.")
    db.set_admin(user.id, change.is_admin)
    return user_info(username)


@router.put("/api/admin/users/{username}/password", responses=ADMIN_USER)
def reset_password(username: str, reset: PasswordReset, request: Request, admin: CurrentAdmin):
    """Set a new password for the user: signs them out everywhere and lifts a sign-in lockout."""
    user = find_named_user(username)
    session_version = db.set_password_hash(user.id, auth.hash_password(reset.new_password))
    if user.id == admin.id:
        request.session["session_version"] = session_version  # stay signed in here
    auth.clear_failures(username)
    return {"status": "ok"}


@router.delete(
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
