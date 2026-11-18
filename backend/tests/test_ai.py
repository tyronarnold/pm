import os

import pytest

from app import ai
from app.board import DEFAULT_BOARD, apply_operations

# Every test here calls OpenRouter for real.
pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(not os.environ.get("OPENROUTER_API_KEY"), reason="OPENROUTER_API_KEY not set"),
]


def test_live_two_plus_two():
    answer = ai.ask([{"role": "user", "content": "What is 2+2? Reply with just the number."}])
    assert "4" in answer


def test_live_chat_creates_card():
    result = ai.chat(DEFAULT_BOARD, [], "Add a card called Test to Backlog")
    assert result.reply
    creates = [op for op in result.operations if op.type == "create_card"]
    assert len(creates) == 1
    assert creates[0].column_id == "col-backlog"
    assert creates[0].title == "Test"


def test_live_chat_deletes_card():
    result = ai.chat(DEFAULT_BOARD, [], "Delete the QA micro-interactions card.")
    board, _ = apply_operations(DEFAULT_BOARD, result.operations)
    assert "card-6" not in board.cards
    assert len(board.cards) == len(DEFAULT_BOARD.cards) - 1


def test_live_chat_creates_then_moves_card():
    result = ai.chat(DEFAULT_BOARD, [], 'Create a card titled "Ship it" in Backlog, then move it to Done.')
    board, _ = apply_operations(DEFAULT_BOARD, result.operations)
    done = next(c for c in board.columns if c.id == "col-done")
    assert "Ship it" in [board.cards[card_id].title for card_id in done.cardIds]
