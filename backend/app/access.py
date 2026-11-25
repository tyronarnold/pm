"""Who may do what: the signed-in user, admins, and boards a user can see or owns.

Every protected route depends on `CurrentUser` (or `CurrentAdmin`), and board routes
look boards up with `find_board` / `find_owned_board`.
"""

from typing import Annotated

from fastapi import Depends, HTTPException, Request

from app import db


def current_user(request: Request) -> db.User:
    """The signed-in user, loaded on every request so a deleted account, or a session from
    before a password change, is signed out."""
    user_id = request.session.get("user_id")
    user = db.get_user(user_id) if user_id else None
    if user is None or request.session.get("session_version") != user.session_version:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


CurrentUser = Annotated[db.User, Depends(current_user)]


def current_admin(user: CurrentUser) -> db.User:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Only admins can do that.")
    return user


CurrentAdmin = Annotated[db.User, Depends(current_admin)]

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
