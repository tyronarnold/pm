import uuid
from datetime import date
from typing import Annotated, Literal, NamedTuple

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, model_validator

Priority = Literal["low", "medium", "high"]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]


class Card(BaseModel):
    """A card. Priority, due date and labels are optional, so boards saved before they existed stay valid."""

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    details: str
    priority: Priority | None = None
    dueDate: date | None = None
    labels: list[Label] = Field(default=[], max_length=10)


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


# New boards get the standard columns and no cards.
EMPTY_BOARD = Board(
    columns=[Column(id=column.id, title=column.title, cardIds=[]) for column in DEFAULT_BOARD.columns],
    cards={},
)


def column_ids(board: Board) -> list[str]:
    return [column.id for column in board.columns]


class Operation(BaseModel):
    """A change to the board. Fields an operation does not use are null.

    create_card: card_id (a temporary id that later operations in the same list
        can use to refer to the new card), column_id, title, details,
        position (null = end of column), priority, due_date, labels
    edit_card: card_id, and any of title, details, priority, due_date, labels
        (null = unchanged)
    move_card: card_id, column_id, position (null = end of column)
    delete_card: card_id

    The model always sends every field (Structured Outputs), so the defaults only
    make operations shorter to write in code and tests.
    """

    type: Literal["create_card", "edit_card", "move_card", "delete_card"]
    card_id: str | None = None
    column_id: str | None = None
    title: str | None = None
    details: str | None = None
    position: int | None = None
    priority: Priority | None = None
    due_date: str | None = None  # YYYY-MM-DD; checked when the card is built
    labels: list[str] | None = None

    def card_fields(self) -> dict:
        """The card fields this operation sets (those that are not null), in the Card's names."""
        fields = {
            "title": self.title,
            "details": self.details,
            "priority": self.priority,
            "dueDate": self.due_date,
            "labels": self.labels,
        }
        return {name: value for name, value in fields.items() if value is not None}


def _insert(card_ids: list[str], card_id: str, position: int | None) -> None:
    if position is None:
        card_ids.append(card_id)
    else:
        card_ids.insert(max(0, position), card_id)


def _remove(board: Board, card_id: str) -> None:
    """Take a card out of whichever column holds it."""
    for column in board.columns:
        if card_id in column.cardIds:
            column.cardIds.remove(card_id)


class Applied(NamedTuple):
    board: Board
    skipped: list[Operation]


def _build_card(fields: dict) -> Card | None:
    """The card, or None if a field is invalid (no title, a bad date, too many labels)."""
    try:
        return Card.model_validate(fields)
    except ValidationError:
        return None


def apply_operations(board: Board, operations: list[Operation]) -> Applied:
    """Return a new board with the operations applied in order, plus the skipped ones.

    New cards always get a generated id; the temporary card_id given in
    create_card is mapped to it for the rest of the list. Operations that
    reference unknown cards or columns, change nothing, or would leave a card
    invalid (no title, a bad due date, too many labels) are skipped.
    """
    board = board.model_copy(deep=True)
    columns = {column.id: column for column in board.columns}
    new_ids: dict[str, str] = {}
    skipped: list[Operation] = []

    for op in operations:
        if op.type == "create_card":
            card_id = f"card-{uuid.uuid4().hex[:12]}"
            card = _build_card({"details": "", **op.card_fields(), "id": card_id})
            if op.column_id not in columns or card is None:
                skipped.append(op)
                continue
            if op.card_id:
                new_ids[op.card_id] = card_id
            board.cards[card_id] = card
            _insert(columns[op.column_id].cardIds, card_id, op.position)
            continue

        card_id = new_ids.get(op.card_id, op.card_id)

        if op.type == "edit_card":
            card = board.cards.get(card_id)
            changes = op.card_fields()
            edited = card and changes and _build_card({**card.model_dump(), **changes})
            if not edited:
                skipped.append(op)
                continue
            board.cards[card_id] = edited

        elif op.type == "move_card":
            if card_id not in board.cards or op.column_id not in columns:
                skipped.append(op)
                continue
            _remove(board, card_id)
            _insert(columns[op.column_id].cardIds, card_id, op.position)

        elif op.type == "delete_card":
            if card_id not in board.cards:
                skipped.append(op)
                continue
            _remove(board, card_id)
            del board.cards[card_id]

    return Applied(board, skipped)
