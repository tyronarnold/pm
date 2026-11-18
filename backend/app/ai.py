import os
from typing import Literal

from openai import OpenAI
from pydantic import BaseModel

from app.board import Board, Operation

MODEL = "anthropic/claude-haiku-5.5"
REASONING = {"reasoning": {"effort": "low"}}

SYSTEM_PROMPT = """You are the assistant inside a Kanban project management app. \
You help the user plan and manage the cards on their board.

The board has a fixed set of columns (you cannot add, remove or rename them). \
Each column lists its cards in order, top to bottom. Each card has a title and details.

To change the board, return operations. Allowed operations:
- create_card: card_id (a temporary id you choose, such as "new-1"; later operations in the same reply \
can use it to edit or move the new card), column_id, title, details (may be empty), position (0 = top, null = bottom).
- edit_card: card_id, plus the new title and/or details. Use null for a field that should not change.
- move_card: card_id, column_id (the destination; may be the same column to reorder), position (0 = top, null = bottom).
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


def client() -> OpenAI:
    return OpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=os.environ["OPENROUTER_API_KEY"],
    )


def ask(messages: list[dict]) -> str:
    response = client().chat.completions.create(
        model=MODEL, messages=messages, extra_body=REASONING
    )
    return response.choices[0].message.content


def build_messages(board: Board, history: list[ChatMessage], message: str) -> list[dict]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": f"Current board JSON:\n{board.model_dump_json()}"},
        *(m.model_dump() for m in history),
        {"role": "user", "content": message},
    ]


def chat(board: Board, history: list[ChatMessage], message: str) -> ChatResult:
    response = client().chat.completions.parse(
        model=MODEL,
        messages=build_messages(board, history, message),
        response_format=ChatResult,
        extra_body=REASONING,
    )
    return response.choices[0].message.parsed
