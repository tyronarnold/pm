import logging
import os
from datetime import date
from typing import Literal

import openai
from openai import OpenAI
from pydantic import BaseModel

from app.board import Board, Operation

logger = logging.getLogger(__name__)

MODEL = "anthropic/claude-haiku-5.5"
REASONING = {"reasoning": {"effort": "low"}}
TIMEOUT_SECONDS = 30  # per attempt; the SDK retries once, so a failing call gives up after about a minute

SYSTEM_PROMPT = """You are the assistant inside a Kanban project management app. \
You help the user plan and manage the cards on their board.

The board has a fixed set of columns (you cannot add, remove or rename them). \
Each column lists its cards in order, top to bottom. Each card has a title and details, and optionally \
a priority ("low", "medium" or "high"), a due date (dueDate, YYYY-MM-DD) and labels (short tags).

To change the board, return operations. Allowed operations:
- create_card: card_id (a temporary id you choose, such as "new-1"; later operations in the same reply \
can use it to edit or move the new card), column_id, title, details (may be empty), position (0 = top, null = bottom), \
and optionally priority, due_date (YYYY-MM-DD) and labels (a list of short tags).
- edit_card: card_id, plus any of title, details, priority, due_date and labels to change. \
Use null for a field that should not change. labels replaces the card's whole list of labels.
- move_card: card_id, column_id (the destination; may be the same column to reorder), position (0 = top, null = bottom).
- delete_card: card_id. Only delete cards the user clearly asked you to delete; if it is unclear which card \
they mean, ask instead of deleting.
Set fields an operation does not use to null. Use the exact ids from the board. \
Operations are applied in order. Return an empty list when no change is needed, \
for example when the user only asks a question.

Always include a short, friendly reply to the user describing what you did or answering their question. \
Do not mention ids in the reply."""


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatResult(BaseModel):
    reply: str
    operations: list[Operation]


class AIError(Exception):
    """The AI call failed. The message is written for the user."""


def client() -> OpenAI:
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
        timeout=TIMEOUT_SECONDS,
        max_retries=1,
    )


def ask(messages: list[dict]) -> str:
    response = client().chat.completions.create(
        model=MODEL, messages=messages, extra_body=REASONING
    )
    return response.choices[0].message.content


BOARD_HEADING = "Current board JSON:\n"


def build_messages(board: Board, history: list[ChatMessage], message: str) -> list[dict]:
    """The system prompt, today's date (for due dates) and the board, then the conversation."""
    context = f"Today is {date.today().isoformat()}.\n{BOARD_HEADING}{board.model_dump_json()}"
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": context},
        *(m.model_dump() for m in history),
        {"role": "user", "content": message},
    ]


def chat(board: Board, history: list[ChatMessage], message: str) -> ChatResult:
    """Ask the AI about the board. Raises AIError with a user-facing message on failure."""
    try:
        response = client().chat.completions.parse(
            model=MODEL,
            messages=build_messages(board, history, message),
            response_format=ChatResult,
            extra_body=REASONING,
        )
    except openai.APITimeoutError as error:
        logger.warning("AI call timed out", exc_info=True)
        raise AIError("The AI took too long to reply. Please try again.") from error
    except openai.OpenAIError as error:
        # Connection and HTTP errors, and replies cut off by length or a content filter.
        logger.warning("AI call failed", exc_info=True)
        raise AIError("The AI service could not be reached. Please try again.") from error
    result = response.choices[0].message.parsed
    if result is None:  # the model refused
        raise AIError("The AI could not answer that. Please rephrase and try again.")
    return result
