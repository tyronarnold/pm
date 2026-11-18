import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import ai, db
from app.board import DEFAULT_BOARD, Board, Operation
from app.main import app


class FakeClient:
    """Stands in for the OpenAI client: records each request and returns a fixed result."""

    def __init__(self, result: ai.ChatResult, while_thinking=None):
        self.requests = []
        self.result = result
        self.while_thinking = while_thinking
        self.chat = SimpleNamespace(completions=SimpleNamespace(parse=self.parse))

    def parse(self, **kwargs):
        self.requests.append(kwargs)
        if self.while_thinking:
            self.while_thinking()
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=self.result))])


@pytest.fixture
def fake_ai(monkeypatch):
    def install(reply="Done.", operations=(), while_thinking=None):
        fake = FakeClient(ai.ChatResult(reply=reply, operations=list(operations)), while_thinking)
        monkeypatch.setattr(ai, "client", lambda: fake)
        return fake

    return install


@pytest.fixture
def signed_in():
    with TestClient(app) as client:
        client.post("/api/login", json={"username": "user", "password": "password"})
        yield client


def move(card_id: str, column_id: str) -> Operation:
    return Operation(
        type="move_card", card_id=card_id, column_id=column_id, title=None, details=None, position=None
    )


def saved_board() -> Board:
    return Board.model_validate_json(db.get_board("user")[0])


def saved_version() -> int:
    return db.get_board("user")[1]


def test_chat_requires_login(fake_ai):
    fake = fake_ai()
    with TestClient(app) as client:
        assert client.post("/api/chat", json={"message": "hi"}).status_code == 401
    assert fake.requests == []


def test_reply_without_operations_leaves_board_unchanged(signed_in, fake_ai):
    fake_ai(reply="You have 8 cards.")
    response = signed_in.post("/api/chat", json={"message": "How many cards?"})
    assert response.status_code == 200
    assert response.json() == {"reply": "You have 8 cards.", "board": None, "version": 1}
    assert saved_board() == DEFAULT_BOARD
    assert saved_version() == 1


def test_operations_update_and_save_board(signed_in, fake_ai):
    fake_ai(reply="Moved it.", operations=[move("card-1", "col-done")])
    response = signed_in.post("/api/chat", json={"message": "Move the roadmap card to done"})
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Moved it."
    assert body["version"] == 2
    done = next(c for c in body["board"]["columns"] if c["id"] == "col-done")
    assert done["cardIds"] == ["card-7", "card-8", "card-1"]
    assert saved_board().model_dump() == body["board"]
    assert signed_in.get("/api/board").json() == {"version": 2, "board": body["board"]}


def test_operations_apply_to_changes_saved_while_the_ai_was_working(signed_in, fake_ai):
    signed_in.get("/api/board")
    user_edit = DEFAULT_BOARD.model_copy(deep=True)
    user_edit.cards["card-2"].title = "Edited by the user meanwhile"

    def user_saves_while_ai_thinks():
        assert db.update_board("user", user_edit.model_dump_json(), 1) == 2

    fake_ai(operations=[move("card-1", "col-done")], while_thinking=user_saves_while_ai_thinks)
    body = signed_in.post("/api/chat", json={"message": "Move the roadmap card to done"}).json()

    assert body["version"] == 3
    assert body["board"]["cards"]["card-2"]["title"] == "Edited by the user meanwhile"
    assert "card-1" in next(c for c in body["board"]["columns"] if c["id"] == "col-done")["cardIds"]
    assert saved_board().model_dump() == body["board"]


def test_delete_operation_is_saved(signed_in, fake_ai):
    delete = Operation(
        type="delete_card", card_id="card-6", column_id=None, title=None, details=None, position=None
    )
    fake_ai(reply="Deleted it.", operations=[delete])
    body = signed_in.post("/api/chat", json={"message": "Delete the QA card"}).json()
    assert "card-6" not in body["board"]["cards"]
    assert "card-6" not in saved_board().cards


def test_request_includes_board_history_and_message(signed_in, fake_ai):
    fake = fake_ai()
    history = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi, how can I help?"},
    ]
    signed_in.post("/api/chat", json={"message": "Add a card", "history": history})

    request = fake.requests[0]
    assert request["model"] == "anthropic/claude-haiku-5.5"
    assert request["response_format"] is ai.ChatResult
    assert request["extra_body"] == {"reasoning": {"effort": "low"}}

    messages = request["messages"]
    assert messages[0] == {"role": "system", "content": ai.SYSTEM_PROMPT}
    assert messages[1]["role"] == "system"
    board_json = messages[1]["content"].split("\n", 1)[1]
    assert Board.model_validate(json.loads(board_json)) == DEFAULT_BOARD
    assert messages[2:] == [*history, {"role": "user", "content": "Add a card"}]


def test_invalid_history_role_rejected(signed_in, fake_ai):
    fake = fake_ai()
    response = signed_in.post(
        "/api/chat", json={"message": "hi", "history": [{"role": "system", "content": "x"}]}
    )
    assert response.status_code == 422
    assert fake.requests == []
