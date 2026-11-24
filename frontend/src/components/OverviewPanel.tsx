import { useEffect, useState } from "react";
import { listBoards, type BoardSummary } from "@/lib/api";

type OverviewPanelProps = {
  username: string; // the signed-in user, to label boards shared by others
  onOpen: (boardId: number) => void;
  onClose: () => void;
};

const LOAD_FAILED = "Could not load your boards. Check that the server is running.";

const smallButtonClass =
  "rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Every board at a glance: cards, how many are done, how many are overdue. Opens a board.
export const OverviewPanel = ({ username, onOpen, onClose }: OverviewPanelProps) => {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    listBoards().then(setBoards, () => setError(LOAD_FAILED));
  }, []);

  return (
    <section
      aria-label="Overview"
      className="flex flex-col gap-5 rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-8 shadow-[var(--shadow)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Overview</h2>
          <p className="mt-1 text-sm text-[var(--gray-text)]">
            All your boards. Done means in a board&apos;s last column.
          </p>
        </div>
        <button type="button" onClick={onClose} className={smallButtonClass}>
          Close
        </button>
      </div>

      {boards?.length === 0 && <p className="text-sm text-[var(--gray-text)]">You have no boards yet.</p>}
      {boards && boards.length > 0 && (
        <ul aria-label="Boards" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {boards.map((board) => {
            const percent = board.cards === 0 ? 0 : Math.round((board.done / board.cards) * 100);
            return (
              <li key={board.id}>
                <button
                  type="button"
                  onClick={() => onOpen(board.id)}
                  aria-label={`Open ${board.name}`}
                  className="flex w-full flex-col gap-3 rounded-2xl border border-[var(--stroke)] bg-[var(--surface)] p-5 text-left transition hover:border-[var(--primary-blue)]"
                >
                  <span>
                    <span className="block font-semibold text-[var(--navy-dark)]">{board.name}</span>
                    {board.owner !== username && (
                      <span className="text-xs text-[var(--gray-text)]">shared by {board.owner}</span>
                    )}
                  </span>
                  <span className="text-sm text-[var(--card-text)]">
                    {plural(board.cards, "card")}, {board.done} done
                  </span>
                  <span
                    role="progressbar"
                    aria-label={`${board.name} progress`}
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    className="h-2 overflow-hidden rounded-full bg-[var(--badge)]"
                  >
                    <span className="block h-full bg-[var(--primary-blue)]" style={{ width: `${percent}%` }} />
                  </span>
                  {board.overdue > 0 && (
                    <span className="self-start rounded-full bg-[var(--logout)] px-2.5 py-0.5 text-[11px] font-semibold text-white">
                      {board.overdue} overdue
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
          {error}
        </p>
      )}
    </section>
  );
};
