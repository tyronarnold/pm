import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Card(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str


class Column(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    title: str
    cardIds: list[str]


class Board(BaseModel):
    model_config = ConfigDict(extra="forbid")

    columns: list[Column]
    cards: dict[str, Card]

    @model_validator(mode="after")
    def check_cards(self):
        placed = sorted(card_id for column in self.columns for card_id in column.cardIds)
        if placed != sorted(self.cards):
            raise ValueError("Every card must appear in exactly one column")
        if any(key != card.id for key, card in self.cards.items()):
            raise ValueError("Card keys must match card ids")
        return self


DEFAULT_BOARD = Board.model_validate(
    {
        "columns": [
            {"id": "col-backlog", "title": "Backlog", "cardIds": ["card-1", "card-2"]},
            {"id": "col-discovery", "title": "Discovery", "cardIds": ["card-3"]},
            {"id": "col-progress", "title": "In Progress", "cardIds": ["card-4", "card-5"]},
            {"id": "col-review", "title": "Review", "cardIds": ["card-6"]},
            {"id": "col-done", "title": "Done", "cardIds": ["card-7", "card-8"]},
        ],
        "cards": {
            "card-1": {
                "id": "card-1",
                "title": "Align roadmap themes",
                "details": "Draft quarterly themes with impact statements and metrics.",
            },
            "card-2": {
                "id": "card-2",
                "title": "Gather customer signals",
                "details": "Review support tags, sales notes, and churn feedback.",
            },
            "card-3": {
                "id": "card-3",
                "title": "Prototype analytics view",
                "details": "Sketch initial dashboard layout and key drill-downs.",
            },
            "card-4": {
                "id": "card-4",
                "title": "Refine status language",
                "details": "Standardize column labels and tone across the board.",
            },
            "card-5": {
                "id": "card-5",
                "title": "Design card layout",
                "details": "Add hierarchy and spacing for scanning dense lists.",
            },
            "card-6": {
                "id": "card-6",
                "title": "QA micro-interactions",
                "details": "Verify hover, focus, and loading states.",
            },
            "card-7": {
                "id": "card-7",
                "title": "Ship marketing page",
                "details": "Final copy approved and asset pack delivered.",
            },
            "card-8": {
                "id": "card-8",
                "title": "Close onboarding sprint",
                "details": "Document release notes and share internally.",
            },
        },
    }
)


def column_ids(board: Board) -> list[str]:
    return [column.id for column in board.columns]


class Operation(BaseModel):
    """A change to the board. Fields an operation does not use are null.

    create_card: card_id (a temporary id that later operations in the same list
        can use to refer to the new card), column_id, title, details,
        position (null = end of column)
    edit_card: card_id, title and/or details (null = unchanged)
    move_card: card_id, column_id, position (null = end of column)
    """

    type: Literal["create_card", "edit_card", "move_card"]
    card_id: str | None
    column_id: str | None
    title: str | None
    details: str | None
    position: int | None


def _insert(card_ids: list[str], card_id: str, position: int | None) -> None:
    if position is None:
        card_ids.append(card_id)
    else:
        card_ids.insert(max(0, position), card_id)


def apply_operations(board: Board, operations: list[Operation]) -> Board:
    """Return a new board with the operations applied in order.

    New cards always get a generated id; the temporary card_id given in
    create_card is mapped to it for the rest of the list. Operations that
    reference unknown cards or columns, or would leave a card without a title,
    are skipped.
    """
    board = board.model_copy(deep=True)
    columns = {column.id: column for column in board.columns}
    new_ids: dict[str, str] = {}

    for op in operations:
        if op.type == "create_card":
            if op.column_id not in columns or not op.title:
                continue
            card_id = f"card-{uuid.uuid4().hex[:12]}"
            if op.card_id:
                new_ids[op.card_id] = card_id
            board.cards[card_id] = Card(id=card_id, title=op.title, details=op.details or "")
            _insert(columns[op.column_id].cardIds, card_id, op.position)
            continue

        card_id = new_ids.get(op.card_id, op.card_id)

        if op.type == "edit_card":
            card = board.cards.get(card_id)
            if card is None:
                continue
            if op.title:
                card.title = op.title
            if op.details is not None:
                card.details = op.details

        elif op.type == "move_card":
            if card_id not in board.cards or op.column_id not in columns:
                continue
            for column in board.columns:
                if card_id in column.cardIds:
                    column.cardIds.remove(card_id)
            _insert(columns[op.column_id].cardIds, card_id, op.position)

    return board
