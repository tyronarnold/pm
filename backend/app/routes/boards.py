"""Boards: list, create, open, rename, delete and save them; their members and activity."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, StringConstraints

from app import db
from app.access import NOT_FOUND, OWNER_ONLY, CurrentUser, find_board, find_owned_board
from app.board import EMPTY_BOARD, Board, board_stats, describe_changes

router = APIRouter()

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
    mine: int  # assigned to the signed-in user, not in the last column


class BoardDetail(BaseModel):
    id: int
    name: str
    owner: str
    members: list[str]  # usernames the board is shared with (not the owner)
    version: int
    board: Board

    @property
    def people(self) -> list[str]:
        """Everyone with access: the owner, then the members."""
        return [self.owner, *self.members]


class NewMember(BaseModel):
    username: Annotated[str, StringConstraints(strip_whitespace=True, to_lower=True)]


class VersionedBoard(BaseModel):
    """A board plus its version. The version goes up by one on every save."""

    version: int
    board: Board


def summary(row: db.BoardRow, username: str) -> BoardSummary:
    """The board's summary, with counts for `username` (the signed-in user)."""
    stats = board_stats(Board.model_validate_json(row.data), date.today(), username)
    return BoardSummary(id=row.id, name=row.name, updated_at=row.updated_at, owner=row.owner, **stats._asdict())


def detail(row: db.BoardRow) -> BoardDetail:
    return BoardDetail(
        id=row.id,
        name=row.name,
        owner=row.owner,
        members=db.list_members(row.id),
        version=row.version,
        board=Board.model_validate_json(row.data),
    )


@router.get("/api/boards")
def list_boards(user: CurrentUser) -> list[BoardSummary]:
    """The boards the user owns or that are shared with them, oldest first."""
    return [summary(row, user.username) for row in db.list_boards(user.id)]


@router.post("/api/boards", status_code=201)
def create_board(new: BoardName, user: CurrentUser) -> BoardDetail:
    """Create a board with the standard columns and no cards."""
    board_id = db.create_board(user.id, new.name, EMPTY_BOARD.model_dump_json())
    db.add_activity(board_id, user.username, ["created the board"])
    return detail(find_board(user, board_id))


@router.get("/api/boards/{board_id}", responses=NOT_FOUND)
def get_board(board_id: int, user: CurrentUser) -> BoardDetail:
    return detail(find_board(user, board_id))


@router.patch("/api/boards/{board_id}", responses=OWNER_ONLY)
def rename_board(board_id: int, new: BoardName, user: CurrentUser) -> BoardSummary:
    old_name = find_owned_board(user, board_id).name
    db.rename_board(user.id, board_id, new.name)
    if new.name != old_name:
        db.add_activity(board_id, user.username, [f'renamed the board from "{old_name}" to "{new.name}"'])
    return summary(find_board(user, board_id), user.username)


@router.delete("/api/boards/{board_id}", status_code=204, responses=OWNER_ONLY)
def delete_board(board_id: int, user: CurrentUser):
    find_owned_board(user, board_id)
    db.delete_board(user.id, board_id)
    return Response(status_code=204)


@router.get("/api/boards/{board_id}/members", responses=NOT_FOUND)
def list_members(board_id: int, user: CurrentUser) -> list[str]:
    """Usernames the board is shared with (not including the owner)."""
    find_board(user, board_id)
    return db.list_members(board_id)


@router.post(
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


@router.delete("/api/boards/{board_id}/members/{username}", status_code=204, responses=OWNER_ONLY)
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


@router.get("/api/boards/{board_id}/activity", responses=NOT_FOUND)
def list_activity(board_id: int, user: CurrentUser) -> list[ActivityEntry]:
    """The board's latest changes, newest first (owner and members)."""
    find_board(user, board_id)
    return [ActivityEntry(**entry._asdict()) for entry in db.list_activity(board_id, ACTIVITY_SHOWN)]


@router.put(
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
