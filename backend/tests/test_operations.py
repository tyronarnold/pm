from app.board import DEFAULT_BOARD, Board, Operation, apply_operations


def op(type: str, **fields) -> Operation:
    defaults = dict(card_id=None, column_id=None, title=None, details=None, position=None)
    return Operation(type=type, **{**defaults, **fields})


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
