import json
from datetime import date
from types import SimpleNamespace

import httpx2
import openai
import pytest
from fastapi.testclient import TestClient

from app import ai, db
from app.board import DEFAULT_BOARD, Board, Operation
from app.main import app


class FakeClient:
    """Stands in for the OpenAI client: records each request and returns a fixed result."""

    def __init__(self, result: ai.ChatResult | None, while_thinking=None, error=None):
        self.requests = []
        self.result = result
        self.while_thinking = while_thinking
        self.error = error
        self.chat = SimpleNamespace(completions=SimpleNamespace(parse=self.parse))

    def parse(self, **kwargs):
        self.requests.append(kwargs)
        if self.while_thinking:
            self.while_thinking()
        if self.error:
            raise self.error
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=self.result))])


@pytest.fixture
def fake_ai(monkeypatch):
    def install(reply="Done.", operations=(), while_thinking=None, error=None, refuse=False):
        result = None if refuse else ai.ChatResult(reply=reply, operations=list(operations))
        fake = FakeClient(result, while_thinking, error)
        monkeypatch.setattr(ai, "client", lambda: fake)
        return fake

    return install


REQUEST = httpx2.Request("POST", "https://openrouter.ai/api/v1/chat/completions")


@pytest.fixture
def chat(signed_in, board_id):
    """Posts a chat message about the demo user's first board."""

    def send(message: str, **body):
        return signed_in.post(f"/api/boards/{board_id}/chat", json={"message": message, **body})

    return send


def move(card_id: str, column_id: str) -> Operation:
    return Operation(
        type="move_card", card_id=card_id, column_id=column_id, title=None, details=None, position=None
    )


def demo_user() -> db.User:
    return db.find_user("user")[0]


def saved_row() -> db.BoardRow:
    return db.list_boards(demo_user().id)[0]


def saved_board() -> Board:
    return Board.model_validate_json(saved_row().data)


def saved_version() -> int:
    return saved_row().version


def test_chat_requires_login(fake_ai):
    fake = fake_ai()
    with TestClient(app) as client:
        assert client.post("/api/boards/1/chat", json={"message": "hi"}).status_code == 401
    assert fake.requests == []


def test_reply_without_operations_leaves_board_unchanged(chat, fake_ai):
    fake_ai(reply="You have 8 cards.")
    response = chat("How many cards?")
    assert response.status_code == 200
    assert response.json() == {"reply": "You have 8 cards.", "board": None, "version": 1}
    assert saved_board() == DEFAULT_BOARD
    assert saved_version() == 1


def test_operations_update_and_save_board(signed_in, board_id, chat, fake_ai):
    fake_ai(reply="Moved it.", operations=[move("card-1", "col-done")])
    response = chat("Move the roadmap card to done")
    assert response.status_code == 200
    body = response.json()
    assert body["reply"] == "Moved it."
    assert body["version"] == 2
    done = next(c for c in body["board"]["columns"] if c["id"] == "col-done")
    assert done["cardIds"] == ["card-7", "card-8", "card-1"]
    assert saved_board().model_dump() == body["board"]
    saved = signed_in.get(f"/api/boards/{board_id}").json()
    assert (saved["version"], saved["board"]) == (2, body["board"])


def test_operations_apply_to_changes_saved_while_the_ai_was_working(chat, board_id, fake_ai):
    user_edit = DEFAULT_BOARD.model_copy(deep=True)
    user_edit.cards["card-2"].title = "Edited by the user meanwhile"

    def user_saves_while_ai_thinks():
        assert db.update_board(demo_user().id, board_id, user_edit.model_dump_json(), 1) == 2

    fake_ai(operations=[move("card-1", "col-done")], while_thinking=user_saves_while_ai_thinks)
    body = chat("Move the roadmap card to done").json()

    assert body["version"] == 3
    assert body["board"]["cards"]["card-2"]["title"] == "Edited by the user meanwhile"
    assert "card-1" in next(c for c in body["board"]["columns"] if c["id"] == "col-done")["cardIds"]
    assert saved_board().model_dump() == body["board"]


def test_delete_operation_is_saved(chat, fake_ai):
    delete = Operation(
        type="delete_card", card_id="card-6", column_id=None, title=None, details=None, position=None
    )
    fake_ai(reply="Deleted it.", operations=[delete])
    body = chat("Delete the QA card").json()
    assert "card-6" not in body["board"]["cards"]
    assert "card-6" not in saved_board().cards


def test_skipped_operations_are_noted_in_the_reply(chat, fake_ai):
    fake_ai(reply="Moved both.", operations=[move("card-1", "col-done"), move("card-404", "col-done")])
    body = chat("Move them").json()
    assert body["reply"].startswith("Moved both.")
    assert "1 requested change could not be applied" in body["reply"]
    assert "card-1" in next(c for c in body["board"]["columns"] if c["id"] == "col-done")["cardIds"]


def test_note_counts_several_skipped_operations_when_nothing_changed(chat, fake_ai):
    fake_ai(reply="Done.", operations=[move("card-404", "col-done"), move("card-1", "col-nope")])
    body = chat("Move them").json()
    assert "2 requested changes could not be applied" in body["reply"]
    assert body["board"] is None
    assert saved_version() == 1


@pytest.mark.parametrize(
    ("error", "message"),
    [
        (openai.APITimeoutError(request=REQUEST), "The AI took too long to reply. Please try again."),
        (openai.APIConnectionError(request=REQUEST), "The AI service could not be reached. Please try again."),
    ],
    ids=["timeout", "connection"],
)
def test_ai_failures_return_502_with_a_message_for_the_user(chat, fake_ai, error, message):
    fake_ai(error=error)
    response = chat("Hello")
    assert response.status_code == 502
    assert response.json() == {"detail": message}
    assert saved_version() == 1


def test_ai_refusal_returns_502_with_a_message_for_the_user(chat, fake_ai):
    fake_ai(refuse=True)
    response = chat("Hello")
    assert response.status_code == 502
    assert response.json() == {"detail": "The AI could not answer that. Please rephrase and try again."}


def test_ai_client_has_a_timeout():
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("OPENROUTER_API_KEY", "test-key")
        client = ai.client()
    assert client.timeout == ai.TIMEOUT_SECONDS
    assert client.max_retries == 1


def test_request_includes_board_history_and_message(chat, fake_ai):
    fake = fake_ai()
    history = [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi, how can I help?"},
    ]
    chat("Add a card", history=history)

    request = fake.requests[0]
    assert request["model"] == "anthropic/claude-haiku-5.5"
    assert request["response_format"] is ai.ChatResult
    assert request["extra_body"] == {"reasoning": {"effort": "low"}}

    messages = request["messages"]
    assert messages[0] == {"role": "system", "content": ai.SYSTEM_PROMPT}
    assert messages[1]["role"] == "system"
    assert messages[1]["content"].startswith(f"Today is {date.today().isoformat()}.")
    board_json = messages[1]["content"].split(ai.BOARD_HEADING, 1)[1]
    assert Board.model_validate(json.loads(board_json)) == DEFAULT_BOARD
    assert messages[2:] == [*history, {"role": "user", "content": "Add a card"}]


def test_invalid_history_role_rejected(chat, fake_ai):
    fake = fake_ai()
    response = chat("hi", history=[{"role": "system", "content": "x"}])
    assert response.status_code == 422
    assert fake.requests == []


def test_chat_uses_and_saves_the_board_in_the_url(signed_in, board_id, fake_ai):
    other = signed_in.post("/api/boards", json={"name": "Other"}).json()
    create = Operation(
        type="create_card", card_id="new-1", column_id="col-backlog", title="Only here", details=None,
        position=None,
    )
    fake = fake_ai(operations=[create])
    body = signed_in.post(f"/api/boards/{other['id']}/chat", json={"message": "Add it"}).json()

    shown = json.loads(fake.requests[0]["messages"][1]["content"].split(ai.BOARD_HEADING, 1)[1])
    assert shown["cards"] == {}  # the AI was shown the empty board, not the first one
    assert [card["title"] for card in body["board"]["cards"].values()] == ["Only here"]
    assert saved_board() == DEFAULT_BOARD  # the first board is untouched


def test_chat_about_an_unknown_board_is_404(signed_in, fake_ai):
    fake = fake_ai()
    assert signed_in.post("/api/boards/999/chat", json={"message": "hi"}).status_code == 404
    assert fake.requests == []
