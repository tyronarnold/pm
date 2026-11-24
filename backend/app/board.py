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
        column_ids = [column.id for column in self.columns]
        if len(set(column_ids)) != len(column_ids):
            raise ValueError("Column ids must be unique")
        if set(column_ids) & set(self.cards):
            # Drag and drop uses column and card ids as one set of targets.
            raise ValueError("A column cannot have the same id as a card")
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


class Operation(BaseModel):
    """A change to the board. Fields an operation does not use are null.

    create_card: card_id (a temporary id that later operations in the same list
        can use to refer to the new card), column_id, title, details,
        position (null = end of column), priority, due_date, labels
    edit_card: card_id, and any of title, details, priority, due_date, labels
        (null = unchanged)
    move_card: card_id, column_id, position (null = end of column)
    delete_card: card_id
    create_column: column_id (a temporary id, like card_id in create_card), title,
        position (null = after the last column)
    rename_column: column_id, title
    delete_column: column_id (only an empty column)

    The model always sends every field (Structured Outputs), so the defaults only
    make operations shorter to write in code and tests.
    """

    type: Literal[
        "create_card", "edit_card", "move_card", "delete_card", "create_column", "rename_column", "delete_column"
    ]
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


def _insert(items: list, item, position: int | None) -> None:
    if position is None:
        items.append(item)
    else:
        items.insert(max(0, position), item)


def _remove(board: Board, card_id: str) -> None:
    """Take a card out of whichever column holds it."""
    for column in board.columns:
        if card_id in column.cardIds:
            column.cardIds.remove(card_id)


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


class Applied(NamedTuple):
    board: Board
    skipped: list[Operation]


def _build_card(fields: dict) -> Card | None:
    """The card, or None if a field is invalid (no title, a bad date, too many labels)."""
    try:
        return Card.model_validate(fields)
    except ValidationError:
        return None


class _NewIds(NamedTuple):
    """Temporary ids given in create operations, mapped to the generated ids."""

    cards: dict[str, str]
    columns: dict[str, str]


def _apply(board: Board, op: Operation, new_ids: _NewIds) -> bool:
    """Apply one operation to the board in place; False if it cannot be applied."""
    column_id = new_ids.columns.get(op.column_id, op.column_id)
    column = next((column for column in board.columns if column.id == column_id), None)
    card_id = new_ids.cards.get(op.card_id, op.card_id)
    card = board.cards.get(card_id)

    match op.type:
        case "create_card":
            new_id = _new_id("card")
            created = _build_card({"details": "", **op.card_fields(), "id": new_id})
            if column is None or created is None:
                return False
            if op.card_id:
                new_ids.cards[op.card_id] = new_id
            board.cards[new_id] = created
            _insert(column.cardIds, new_id, op.position)
        case "edit_card":
            changes = op.card_fields()
            edited = card and changes and _build_card({**card.model_dump(), **changes})
            if not edited:
                return False
            board.cards[card_id] = edited
        case "move_card":
            if card is None or column is None:
                return False
            _remove(board, card_id)
            _insert(column.cardIds, card_id, op.position)
        case "delete_card":
            if card is None:
                return False
            _remove(board, card_id)
            del board.cards[card_id]
        case "create_column":
            if not op.title:
                return False
            new_id = _new_id("col")
            if op.column_id:
                new_ids.columns[op.column_id] = new_id
            _insert(board.columns, Column(id=new_id, title=op.title, cardIds=[]), op.position)
        case "rename_column":
            if column is None or not op.title:
                return False
            column.title = op.title
        case "delete_column":
            if column is None or column.cardIds:
                return False
            board.columns.remove(column)
    return True


def apply_operations(board: Board, operations: list[Operation]) -> Applied:
    """Return a new board with the operations applied in order, plus the skipped ones.

    New cards and columns always get a generated id; a temporary id given in
    create_card or create_column is mapped to it for the rest of the list.
    Operations that reference unknown cards or columns, change nothing, would
    leave a card invalid (no title, a bad due date, too many labels), or delete
    a column that still has cards are skipped.
    """
    board = board.model_copy(deep=True)
    new_ids = _NewIds({}, {})
    skipped = [op for op in operations if not _apply(board, op, new_ids)]
    return Applied(board, skipped)


def describe_changes(old: Board, new: Board) -> list[str]:
    """What changed between two versions of a board, as short sentences for the activity log.

    Columns and cards are matched by id. Moves name both columns; reordering within a
    column, or of the columns themselves, is one entry each.
    """
    changes: list[str] = []
    old_columns = {column.id: column for column in old.columns}
    new_columns = {column.id: column for column in new.columns}

    for column in new.columns:
        before = old_columns.get(column.id)
        if before is None:
            changes.append(f'added column "{column.title}"')
        elif before.title != column.title:
            changes.append(f'renamed column "{before.title}" to "{column.title}"')
    for column in old.columns:
        if column.id not in new_columns:
            changes.append(f'deleted column "{column.title}"')
    kept_before = [column.id for column in old.columns if column.id in new_columns]
    kept_after = [column.id for column in new.columns if column.id in old_columns]
    if kept_before != kept_after:
        changes.append("reordered the columns")

    old_place = {card_id: column for column in old.columns for card_id in column.cardIds}
    new_place = {card_id: column for column in new.columns for card_id in column.cardIds}
    for card_id, card in new.cards.items():
        before = old.cards.get(card_id)
        if before is None:
            changes.append(f'added card "{card.title}" to "{new_place[card_id].title}"')
            continue
        if old_place[card_id].id != new_place[card_id].id:
            changes.append(f'moved "{card.title}" from "{old_place[card_id].title}" to "{new_place[card_id].title}"')
        if before != card:
            changes.append(f'edited "{card.title}"')
    for card_id, card in old.cards.items():
        if card_id not in new.cards:
            changes.append(f'deleted card "{card.title}"')

    for column in new.columns:
        before = old_columns.get(column.id)
        if before is None:
            continue
        stayed_before = [card_id for card_id in before.cardIds if card_id in column.cardIds]
        stayed_after = [card_id for card_id in column.cardIds if card_id in before.cardIds]
        if stayed_before != stayed_after:
            changes.append(f'reordered cards in "{column.title}"')
    return changes


class BoardStats(NamedTuple):
    cards: int
    done: int  # cards in the last column, which holds finished work
    overdue: int  # due before `today`, and not in the last column


def board_stats(board: Board, today: date) -> BoardStats:
    done_ids = set(board.columns[-1].cardIds) if board.columns else set()
    overdue = sum(
        1 for card in board.cards.values() if card.dueDate and card.dueDate < today and card.id not in done_ids
    )
    return BoardStats(cards=len(board.cards), done=len(done_ids), overdue=overdue)
