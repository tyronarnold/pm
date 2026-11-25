"""The AI chat: the AI's operations are applied to the latest saved board and saved."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import ai, db
from app.access import NOT_FOUND, CurrentUser, find_board
from app.board import Board, apply_operations, describe_changes
from app.routes.boards import detail

router = APIRouter()


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
        " that does not exist, had no title, had an invalid value, was a column that still had cards,"
        " or assigned someone who is not on the board.)"
    )


@router.post(
    "/api/boards/{board_id}/chat",
    responses={**NOT_FOUND, 502: {"description": "The AI call failed; `detail` is a message for the user"}},
)
def chat(board_id: int, request: ChatRequest, user: CurrentUser) -> ChatResponse:
    try:
        shown = detail(find_board(user, board_id))
        result = ai.chat(shown.board, shown.people, request.history, request.message)
    except ai.AIError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    # The user may have saved changes while the AI was working, so apply its
    # operations to the latest saved board rather than the one it was shown.
    latest = detail(find_board(user, board_id))
    updated, skipped = apply_operations(latest.board, result.operations, latest.people)
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
