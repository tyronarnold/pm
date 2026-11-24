"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import clsx from "clsx";
import { sendChat, type ChatMessage } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

type ChatSidebarProps = {
  boardId: number;
  onBoardUpdate: (board: BoardData, version: number) => void;
};

export const ChatSidebar = ({ boardId, onBoardUpdate }: ChatSidebarProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, isSending]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isSending) {
      return;
    }
    const history = messages;
    setMessages([...history, { role: "user", content: message }]);
    setInput("");
    setError(null);
    setIsSending(true);
    try {
      const { reply, board, version } = await sendChat(boardId, message, history);
      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
      if (board) {
        onBoardUpdate(board, version);
      }
    } catch (failure) {
      // sendChat's errors carry a message written for the user.
      setError((failure as Error).message);
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) {
    return (
      <aside className="2xl:sticky 2xl:top-6">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="w-full rounded-full border border-[var(--stroke)] bg-white px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--primary-blue)] shadow-[var(--shadow)] transition hover:text-[var(--navy-dark)]"
        >
          Show AI chat
        </button>
      </aside>
    );
  }

  return (
    <aside
      aria-label="AI chat"
      className="flex flex-col rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-5 shadow-[var(--shadow)] 2xl:sticky 2xl:top-6 2xl:w-[270px] 2xl:shrink-0"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="h-2 w-10 rounded-full bg-[var(--accent-yellow)]" />
          <h2 className="mt-3 font-display text-lg font-semibold text-[var(--navy-dark)]">
            AI Assistant
          </h2>
          <p className="mt-1 text-xs text-[var(--gray-text)]">
            Ask me to create, edit, move or delete cards and columns.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(false)}
          className="rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]"
        >
          Hide
        </button>
      </div>

      <div
        ref={listRef}
        role="log"
        aria-label="Chat messages"
        className="mt-4 flex h-60 flex-col gap-3 overflow-y-auto 2xl:h-[360px]"
      >
        {messages.length === 0 && (
          <p className="m-auto max-w-[240px] text-center text-xs text-[var(--gray-text)]">
            Try: &quot;Add a card to Backlog for writing the release notes&quot;.
          </p>
        )}
        {messages.map((message, index) => (
          <p
            key={index}
            className={clsx(
              "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-6",
              message.role === "user"
                ? "self-end bg-[var(--primary-blue)] text-white"
                : "self-start bg-[var(--surface)] text-[var(--navy-dark)]"
            )}
          >
            {message.content}
          </p>
        ))}
        {isSending && (
          <p role="status" className="self-start text-xs font-semibold text-[var(--gray-text)]">
            Thinking...
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-[var(--secondary-purple)]">
          {error}
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Type a message"
          aria-label="Message"
          className="min-w-0 flex-1 rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-sm text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
        />
        <button
          type="submit"
          disabled={isSending || !input.trim()}
          className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110 disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </aside>
  );
};
