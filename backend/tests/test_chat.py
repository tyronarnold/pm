import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app import ai, db
from app.board import DEFAULT_BOARD, Board, Operation
from app.main import app


class FakeClient:
    """Stands in for the OpenAI client: records each request and returns a fixed result."""

    def __init__(self, result: ai.ChatResult):
        self.requests = []
        self.result = result
        self.chat = SimpleNamespace(completions=SimpleNamespace(parse=self.parse))

    def parse(self, **kwargs):
        self.requests.append(kwargs)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=self.result))])


@pytest.fixture
def fake_ai(monkeypatch):
    def install(reply="Done.", operations=()):
        fake = FakeClient(ai.ChatResult(reply=reply, operations=list(operations)))
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
    return Board.model_validate_json(db.get_board("user"))


def test_chat_requires_login(fake_ai):
    fake = fake_ai()
    with TestClient(app) as client:
        assert client.post("/api/chat", json={"message": "hi"}).status_code == 401
    assert fake.requests == []


def test_reply_without_operations_leaves_board_unchanged(signed_in, fake_ai):
    fake_ai(reply="You have 8 cards.")
    response = signed_in.post("/api/chat", json={"message": "How many cards?"})
    assert response.status_code == 200
    assert response.json() == {"reply": "You have 8 cards.", "board": DEFAULT_BOARD.model_dump()}
    assert saved_board() == DEFAULT_BOARD


def test_operations_update_and_save_board(signed_in, fake_ai):
    fake_ai(reply="Moved it.", operations=[move("card-1", "col-done")])
    response = signed_in.post("/api/chat", json={"message": "Move the roadmap card to done"})
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Moved it."
    done = next(c for c in body["board"]["columns"] if c["id"] == "col-done")
    assert done["cardIds"] == ["card-7", "card-8", "card-1"]
    assert saved_board().model_dump() == body["board"]
    assert signed_in.get("/api/board").json() == body["board"]


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
