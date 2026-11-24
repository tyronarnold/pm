from datetime import date
from types import SimpleNamespace

from conftest import register
from fastapi.testclient import TestClient

from app import ai, db
from app.board import DEFAULT_BOARD, Board, Column, Operation, board_stats, describe_changes
from app.main import ACTIVITY_SHOWN, app


def sample() -> Board:
    """A copy of the sample board, for a test to change."""
    return DEFAULT_BOARD.model_copy(deep=True)


def column(board: Board, column_id: str) -> Column:
    return next(c for c in board.columns if c.id == column_id)


# describe_changes


def test_no_changes_describe_nothing():
    assert describe_changes(DEFAULT_BOARD, DEFAULT_BOARD.model_copy(deep=True)) == []


def test_card_added_moved_edited_and_deleted():
    board = sample()
    board.cards["card-9"] = DEFAULT_BOARD.cards["card-1"].model_copy(update={"id": "card-9", "title": "Launch"})
    column(board, "col-review").cardIds.append("card-9")
    column(board, "col-backlog").cardIds.remove("card-1")
    column(board, "col-done").cardIds.append("card-1")
    board.cards["card-3"].priority = "high"
    del board.cards["card-6"]
    column(board, "col-review").cardIds.remove("card-6")

    assert describe_changes(DEFAULT_BOARD, board) == [
        'moved "Align roadmap themes" from "Backlog" to "Done"',
        'edited "Prototype analytics view"',
        'added card "Launch" to "Review"',
        'deleted card "QA micro-interactions"',
    ]


def test_a_moved_and_edited_card_gets_both_entries():
    board = sample()
    column(board, "col-backlog").cardIds.remove("card-1")
    column(board, "col-done").cardIds.insert(0, "card-1")
    board.cards["card-1"].title = "Roadmap themes"
    assert describe_changes(DEFAULT_BOARD, board) == [
        'moved "Roadmap themes" from "Backlog" to "Done"',
        'edited "Roadmap themes"',
    ]


def test_column_added_renamed_deleted_and_reordered():
    board = sample()
    board.columns.append(Column(id="col-blocked", title="Blocked", cardIds=[]))
    column(board, "col-review").title = "QA"
    board.columns = [c for c in board.columns if c.id != "col-discovery"]
    del board.cards["card-3"]
    board.columns[0], board.columns[1] = board.columns[1], board.columns[0]

    assert describe_changes(DEFAULT_BOARD, board) == [
        'renamed column "Review" to "QA"',
        'added column "Blocked"',
        'deleted column "Discovery"',
        "reordered the columns",
        'deleted card "Prototype analytics view"',
    ]


def test_reordering_cards_within_a_column_is_one_entry():
    board = sample()
    column(board, "col-done").cardIds.reverse()
    assert describe_changes(DEFAULT_BOARD, board) == ['reordered cards in "Done"']


def test_moving_a_card_out_does_not_count_as_reordering_the_rest():
    board = sample()
    column(board, "col-progress").cardIds.remove("card-4")
    column(board, "col-done").cardIds.append("card-4")
    assert describe_changes(DEFAULT_BOARD, board) == ['moved "Refine status language" from "In Progress" to "Done"']


# board_stats


def test_board_stats_counts_cards_done_and_overdue():
    board = sample()
    board.cards["card-1"].dueDate = date(2026, 1, 1)  # overdue
    board.cards["card-2"].dueDate = date(2026, 6, 1)  # due today: not overdue
    board.cards["card-7"].dueDate = date(2026, 1, 1)  # in the last column: done, not overdue
    assert board_stats(board, date(2026, 6, 1)) == (8, 2, 1)


def test_board_stats_for_a_board_without_columns():
    assert board_stats(Board(columns=[], cards={}), date(2026, 6, 1)) == (0, 0, 0)


# Routes


def activity(client, board_id: int):
    return client.get(f"/api/boards/{board_id}/activity").json()


def messages(client, board_id: int) -> list[str]:
    return [entry["message"] for entry in activity(client, board_id)]


def test_board_summaries_include_stats(signed_in, board_id):
    [summary] = signed_in.get("/api/boards").json()
    assert (summary["cards"], summary["done"], summary["overdue"]) == (8, 2, 0)


def test_creating_a_board_is_logged(signed_in):
    created = signed_in.post("/api/boards", json={"name": "Launch"}).json()
    [entry] = activity(signed_in, created["id"])
    assert entry["username"] == "user"
    assert entry["message"] == "created the board"
    assert entry["via_ai"] is False
    assert entry["created_at"]


def test_saves_are_logged_newest_first(signed_in, board_id):
    board = DEFAULT_BOARD.model_dump()
    board["cards"]["card-1"]["title"] = "First change"
    signed_in.put(f"/api/boards/{board_id}", json={"version": 1, "board": board})
    board["columns"][0]["title"] = "Ideas"
    signed_in.put(f"/api/boards/{board_id}", json={"version": 2, "board": board})
    assert messages(signed_in, board_id) == [
        'renamed column "Backlog" to "Ideas"',
        'edited "First change"',
        "created the board",
    ]


def test_a_save_that_changes_nothing_is_not_logged(signed_in, board_id):
    signed_in.put(f"/api/boards/{board_id}", json={"version": 1, "board": DEFAULT_BOARD.model_dump()})
    assert messages(signed_in, board_id) == ["created the board"]


def test_a_rejected_save_is_not_logged(signed_in, board_id):
    board = DEFAULT_BOARD.model_dump()
    board["cards"]["card-1"]["title"] = "Stale"
    assert signed_in.put(f"/api/boards/{board_id}", json={"version": 5, "board": board}).status_code == 409
    assert messages(signed_in, board_id) == ["created the board"]


def test_renaming_and_sharing_are_logged(signed_in, board_id):
    with TestClient(app) as alice:
        register(alice)
        signed_in.patch(f"/api/boards/{board_id}", json={"name": "Roadmap"})
        signed_in.patch(f"/api/boards/{board_id}", json={"name": "Roadmap"})  # unchanged: not logged
        signed_in.post(f"/api/boards/{board_id}/members", json={"username": "alice"})
        alice.delete(f"/api/boards/{board_id}/members/alice")
        signed_in.post(f"/api/boards/{board_id}/members", json={"username": "alice"})
        signed_in.delete(f"/api/boards/{board_id}/members/alice")

    entries = [(e["username"], e["message"]) for e in activity(signed_in, board_id)]
    assert entries == [
        ("user", "removed alice from the board"),
        ("user", "shared the board with alice"),
        ("alice", "left the board"),
        ("user", "shared the board with alice"),
        ("user", 'renamed the board from "My first board" to "Roadmap"'),
        ("user", "created the board"),
    ]


def test_members_changes_are_logged_under_their_name(signed_in, board_id):
    with TestClient(app) as alice:
        register(alice)
        signed_in.post(f"/api/boards/{board_id}/members", json={"username": "alice"})
        board = DEFAULT_BOARD.model_dump()
        board["cards"]["card-2"]["details"] = "Changed by alice"
        alice.put(f"/api/boards/{board_id}", json={"version": 1, "board": board})
        assert activity(alice, board_id)[0]["username"] == "alice"
        # The entries outlive alice's account.
        alice.request("DELETE", "/api/me", json={"password": "alice-password"})
    assert (activity(signed_in, board_id)[0]["username"], messages(signed_in, board_id)[0]) == (
        "alice",
        'edited "Gather customer signals"',
    )


def test_ai_changes_are_logged_as_made_with_the_assistant(signed_in, board_id, monkeypatch):
    move = Operation(type="move_card", card_id="card-1", column_id="col-done")
    result = ai.ChatResult(reply="Moved it.", operations=[move])
    fake = SimpleNamespace(
        chat=SimpleNamespace(
            completions=SimpleNamespace(
                parse=lambda **_: SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=result))])
            )
        )
    )
    monkeypatch.setattr(ai, "client", lambda: fake)
    signed_in.post(f"/api/boards/{board_id}/chat", json={"message": "Move it"})
    entry = activity(signed_in, board_id)[0]
    assert entry["message"] == 'moved "Align roadmap themes" from "Backlog" to "Done"'
    assert entry["via_ai"] is True


def test_activity_is_only_for_people_with_access(signed_in, board_id):
    with TestClient(app) as alice:
        register(alice)
        assert alice.get(f"/api/boards/{board_id}/activity").status_code == 404


def test_only_the_latest_entries_are_shown_and_kept(signed_in, board_id, monkeypatch):
    monkeypatch.setattr(db, "ACTIVITY_KEPT", 60)
    db.add_activity(board_id, "user", [f"change {i}" for i in range(100)])
    shown = messages(signed_in, board_id)
    assert len(shown) == ACTIVITY_SHOWN
    assert shown[0] == "change 99"
    assert len(db.list_activity(board_id, 1000)) == 60


def test_deleting_a_board_deletes_its_activity(signed_in, board_id):
    db.add_activity(board_id, "user", ["something"])
    signed_in.delete(f"/api/boards/{board_id}")
    assert db.list_activity(board_id, 10) == []
