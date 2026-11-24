import { useState, type FormEvent } from "react";
import type { BoardDetail, BoardSummary } from "@/lib/api";

type BoardBarProps = {
  boards: BoardSummary[];
  current: BoardDetail | null;
  onSelect: (id: number) => void;
  onCreate: (name: string) => Promise<void>;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
};

const buttonClass =
  "rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--navy-dark)] transition hover:border-[var(--primary-blue)] hover:text-[var(--primary-blue)]";

// Board switcher plus new / rename / delete. New and rename swap the bar for a name form.
export const BoardBar = ({ boards, current, onSelect, onCreate, onRename, onDelete }: BoardBarProps) => {
  const [mode, setMode] = useState<"create" | "rename" | null>(null);
  const [name, setName] = useState("");

  const start = (next: "create" | "rename") => {
    setName(next === "rename" && current ? current.name : "");
    setMode(next);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }
    await (mode === "create" ? onCreate : onRename)(name.trim());
    setMode(null);
  };

  if (mode) {
    return (
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          aria-label={mode === "create" ? "New board name" : "Board name"}
          placeholder="Board name"
          maxLength={100}
          autoFocus
          className="min-w-[240px] rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-sm font-medium text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
          required
        />
        <button
          type="submit"
          className="rounded-full bg-[var(--secondary-purple)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          {mode === "create" ? "Create board" : "Save name"}
        </button>
        <button type="button" onClick={() => setMode(null)} className={buttonClass}>
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {current && (
        <label className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--gray-text)]">
          Board
          <select
            value={current.id}
            onChange={(event) => onSelect(Number(event.target.value))}
            className="min-w-[220px] rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-sm font-semibold normal-case tracking-normal text-[var(--navy-dark)] outline-none transition focus:border-[var(--primary-blue)]"
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="button" onClick={() => start("create")} className={buttonClass}>
        New board
      </button>
      {current && (
        <>
          <button type="button" onClick={() => start("rename")} className={buttonClass}>
            Rename board
          </button>
          <button type="button" onClick={onDelete} className={buttonClass}>
            Delete board
          </button>
        </>
      )}
    </div>
  );
};
