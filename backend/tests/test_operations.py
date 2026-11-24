from datetime import date

from app.board import DEFAULT_BOARD, Board, Operation, apply_operations


def op(type: str, **fields) -> Operation:
    return Operation(type=type, **fields)


def column(board: Board, column_id: str) -> list[str]:
    return next(c.cardIds for c in board.columns if c.id == column_id)


def test_create_card_at_end_and_at_position():
    board, _ = apply_operations(
        DEFAULT_BOARD,
        [
            op("create_card", column_id="col-review", title="Last", details="d"),
            op("create_card", column_id="col-review", title="First", position=0),
        ],
    )
    ids = column(board, "col-review")
    assert len(ids) == 3
    assert board.cards[ids[0]].title == "First"
    assert board.cards[ids[0]].details == ""
    assert board.cards[ids[2]].title == "Last"
    assert board.cards[ids[2]].details == "d"
    assert ids[0].startswith("card-") and ids[0] != ids[2]


def test_edit_title_and_details():
    board, _ = apply_operations(
        DEFAULT_BOARD,
        [
            op("edit_card", card_id="card-1", title="New title"),
            op("edit_card", card_id="card-2", details="New details"),
        ],
    )
    assert board.cards["card-1"].title == "New title"
    assert board.cards["card-1"].details == DEFAULT_BOARD.cards["card-1"].details
    assert board.cards["card-2"].title == DEFAULT_BOARD.cards["card-2"].title
    assert board.cards["card-2"].details == "New details"


def test_move_across_columns():
    board, _ = apply_operations(DEFAULT_BOARD, [op("move_card", card_id="card-1", column_id="col-done")])
    assert column(board, "col-backlog") == ["card-2"]
    assert column(board, "col-done") == ["card-7", "card-8", "card-1"]


def test_move_within_column_to_position():
    board, _ = apply_operations(
        DEFAULT_BOARD, [op("move_card", card_id="card-8", column_id="col-done", position=0)]
    )
    assert column(board, "col-done") == ["card-8", "card-7"]


def test_several_operations_in_order():
    board, skipped = apply_operations(
        DEFAULT_BOARD,
        [
            op("create_card", column_id="col-backlog", title="Plan"),
            op("move_card", card_id="card-3", column_id="col-progress", position=1),
            op("edit_card", card_id="card-3", title="Analytics view, in progress"),
        ],
    )
    assert skipped == []
    assert len(column(board, "col-backlog")) == 3
    assert column(board, "col-discovery") == []
    assert column(board, "col-progress") == ["card-4", "card-3", "card-5"]
    assert board.cards["card-3"].title == "Analytics view, in progress"
    Board.model_validate(board.model_dump())


def test_later_operations_can_use_a_new_cards_temporary_id():
    board, _ = apply_operations(
        DEFAULT_BOARD,
        [
            op("create_card", card_id="new-1", column_id="col-backlog", title="Fresh"),
            op("move_card", card_id="new-1", column_id="col-done", position=0),
            op("edit_card", card_id="new-1", details="Moved straight to done"),
        ],
    )
    new_id = column(board, "col-done")[0]
    assert new_id.startswith("card-") and new_id != "new-1"
    assert column(board, "col-backlog") == ["card-1", "card-2"]
    assert board.cards[new_id].title == "Fresh"
    assert board.cards[new_id].details == "Moved straight to done"
    assert "new-1" not in board.cards


def test_temporary_id_matching_an_existing_card_does_not_overwrite_it():
    board, _ = apply_operations(
        DEFAULT_BOARD,
        [
            op("create_card", card_id="card-1", column_id="col-review", title="Fresh"),
            op("edit_card", card_id="card-1", title="Edited fresh"),
        ],
    )
    new_id = column(board, "col-review")[-1]
    assert new_id != "card-1"
    assert board.cards[new_id].title == "Edited fresh"
    assert board.cards["card-1"] == DEFAULT_BOARD.cards["card-1"]


def test_delete_card():
    board, _ = apply_operations(DEFAULT_BOARD, [op("delete_card", card_id="card-7")])
    assert "card-7" not in board.cards
    assert column(board, "col-done") == ["card-8"]
    Board.model_validate(board.model_dump())


def test_delete_card_created_in_the_same_list():
    board, _ = apply_operations(
        DEFAULT_BOARD,
        [
            op("create_card", card_id="new-1", column_id="col-backlog", title="Oops"),
            op("delete_card", card_id="new-1"),
        ],
    )
    assert board == DEFAULT_BOARD


def test_unknown_ids_and_empty_titles_are_skipped():
    operations = [
        op("create_card", column_id="col-nope", title="Lost"),
        op("create_card", column_id="col-backlog", title=""),
        op("edit_card", card_id="card-404", title="Ghost"),
        op("move_card", card_id="card-404", column_id="col-done"),
        op("move_card", card_id="card-1", column_id="col-nope"),
        op("edit_card", card_id="card-1", title=""),
        op("delete_card", card_id="card-404"),
    ]
    board, skipped = apply_operations(DEFAULT_BOARD, operations)
    assert board == DEFAULT_BOARD
    assert skipped == operations


def test_only_the_invalid_operations_are_reported_as_skipped():
    ghost = op("move_card", card_id="card-404", column_id="col-done")
    board, skipped = apply_operations(
        DEFAULT_BOARD, [op("delete_card", card_id="card-7"), ghost]
    )
    assert "card-7" not in board.cards
    assert skipped == [ghost]


def test_input_board_is_not_changed():
    before = DEFAULT_BOARD.model_dump()
    apply_operations(
        DEFAULT_BOARD,
        [
            op("move_card", card_id="card-1", column_id="col-done"),
            op("edit_card", card_id="card-2", title="Changed"),
        ],
    )
    assert DEFAULT_BOARD.model_dump() == before


def test_create_card_with_priority_due_date_and_labels():
    board, skipped = apply_operations(
        DEFAULT_BOARD,
        [
            op(
                "create_card", column_id="col-backlog", title="Launch", priority="high",
                due_date="2026-12-01", labels=[" launch ", "marketing"],
            )
        ],
    )
    assert skipped == []
    card = board.cards[column(board, "col-backlog")[-1]]
    assert card.priority == "high"
    assert card.dueDate == date(2026, 12, 1)
    assert card.labels == ["launch", "marketing"]


def test_new_cards_have_no_priority_due_date_or_labels_by_default():
    board, _ = apply_operations(DEFAULT_BOARD, [op("create_card", column_id="col-backlog", title="Plain")])
    card = board.cards[column(board, "col-backlog")[-1]]
    assert (card.priority, card.dueDate, card.labels) == (None, None, [])


def test_edit_priority_due_date_and_labels_keeps_the_rest():
    board, skipped = apply_operations(
        DEFAULT_BOARD,
        [
            op("edit_card", card_id="card-1", priority="low"),
            op("edit_card", card_id="card-1", due_date="2027-01-15"),
            op("edit_card", card_id="card-1", labels=["planning"]),
        ],
    )
    assert skipped == []
    card = board.cards["card-1"]
    assert (card.priority, card.dueDate, card.labels) == ("low", date(2027, 1, 15), ["planning"])
    assert (card.title, card.details) == (DEFAULT_BOARD.cards["card-1"].title, DEFAULT_BOARD.cards["card-1"].details)


def test_edit_can_clear_labels_with_an_empty_list():
    board, _ = apply_operations(DEFAULT_BOARD, [op("edit_card", card_id="card-1", labels=["a"])])
    board, skipped = apply_operations(board, [op("edit_card", card_id="card-1", labels=[])])
    assert skipped == []
    assert board.cards["card-1"].labels == []


def test_invalid_card_values_are_skipped():
    operations = [
        op("create_card", column_id="col-backlog", title="Bad date", due_date="next friday"),
        op("create_card", column_id="col-backlog", title="Too many", labels=[f"l{i}" for i in range(11)]),
        op("create_card", column_id="col-backlog", title="Long label", labels=["x" * 31]),
        op("edit_card", card_id="card-1", due_date="2026-02-30"),
        op("edit_card", card_id="card-1", labels=["  "]),
        op("edit_card", card_id="card-1"),  # changes nothing
    ]
    board, skipped = apply_operations(DEFAULT_BOARD, operations)
    assert board == DEFAULT_BOARD
    assert skipped == operations


def titles(board: Board) -> list[str]:
    return [c.title for c in board.columns]


def test_create_column_at_the_end_and_at_a_position():
    board, skipped = apply_operations(
        DEFAULT_BOARD,
        [op("create_column", title="Ideas"), op("create_column", title="Blocked", position=3)],
    )
    assert skipped == []
    assert titles(board) == ["Backlog", "Discovery", "In Progress", "Blocked", "Review", "Done", "Ideas"]
    new = board.columns[3]
    assert new.id.startswith("col-") and new.cardIds == []
    Board.model_validate(board.model_dump())


def test_later_operations_can_use_a_new_columns_temporary_id():
    board, skipped = apply_operations(
        DEFAULT_BOARD,
        [
            op("create_column", column_id="new-col", title="Blocked"),
            op("move_card", card_id="card-4", column_id="new-col"),
            op("create_card", column_id="new-col", title="Waiting on legal"),
            op("rename_column", column_id="new-col", title="On hold"),
        ],
    )
    assert skipped == []
    on_hold = board.columns[-1]
    assert on_hold.title == "On hold" and on_hold.id != "new-col"
    assert on_hold.cardIds[0] == "card-4"
    assert board.cards[on_hold.cardIds[1]].title == "Waiting on legal"


def test_temporary_column_id_matching_an_existing_column_does_not_replace_it():
    board, _ = apply_operations(
        DEFAULT_BOARD,
        [op("create_column", column_id="col-done", title="New"), op("rename_column", column_id="col-done", title="X")],
    )
    assert titles(board) == ["Backlog", "Discovery", "In Progress", "Review", "Done", "X"]


def test_rename_column():
    board, skipped = apply_operations(DEFAULT_BOARD, [op("rename_column", column_id="col-review", title="QA")])
    assert skipped == []
    assert titles(board)[3] == "QA"


def test_delete_an_empty_column():
    board, skipped = apply_operations(
        DEFAULT_BOARD,
        [op("move_card", card_id="card-6", column_id="col-done"), op("delete_column", column_id="col-review")],
    )
    assert skipped == []
    assert "Review" not in titles(board)
    assert "card-6" in column(board, "col-done")


def test_invalid_column_operations_are_skipped():
    operations = [
        op("create_column", title=""),
        op("create_column"),
        op("rename_column", column_id="col-nope", title="X"),
        op("rename_column", column_id="col-done", title=""),
        op("delete_column", column_id="col-nope"),
        op("delete_column", column_id="col-done"),  # still has cards
    ]
    board, skipped = apply_operations(DEFAULT_BOARD, operations)
    assert board == DEFAULT_BOARD
    assert skipped == operations
