import { useEffect, useState } from "react";
import { listActivity, type ActivityEntry } from "@/lib/api";

type ActivityPanelProps = {
  boardId: number;
  onClose: () => void;
};

const LOAD_FAILED = "Could not load the activity. Check that the server is running.";

const smallButtonClass =
  "rounded-full border border-[var(--stroke)] px-3 py-1 text-xs font-semibold uppercase tracking-wide text-[var(--gray-text)] transition hover:text-[var(--navy-dark)]";

// Server timestamps are UTC ("2026-11-24 21:58:41"); show them in local time.
export const formatTimestamp = (timestamp: string) =>
  new Date(`${timestamp.replace(" ", "T")}Z`).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

// The board's latest changes, newest first: who did what, and when.
export const ActivityPanel = ({ boardId, onClose }: ActivityPanelProps) => {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [error, setError] = useState("");

  const load = () =>
    listActivity(boardId).then(
      (loaded) => {
        setEntries(loaded);
        setError("");
      },
      () => setError(LOAD_FAILED)
    );

  useEffect(() => {
    listActivity(boardId).then(setEntries, () => setError(LOAD_FAILED));
  }, [boardId]);

  return (
    <section
      aria-label="Activity"
      className="flex flex-col gap-5 rounded-3xl border border-[var(--stroke)] bg-[var(--surface-strong)] p-8 shadow-[var(--shadow)]"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-lg font-semibold text-[var(--navy-dark)]">Activity</h2>
          <p className="mt-1 text-sm text-[var(--gray-text)]">The latest changes to this board, newest first.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={load} className={smallButtonClass}>
            Refresh
          </button>
          <button type="button" onClick={onClose} className={smallButtonClass}>
            Close
          </button>
        </div>
      </div>

      {entries?.length === 0 && <p className="text-sm text-[var(--gray-text)]">Nothing has happened yet.</p>}
      {entries && entries.length > 0 && (
        <ol aria-label="Changes" className="flex max-h-[360px] flex-col gap-3 overflow-y-auto">
          {entries.map((entry, index) => (
            <li key={index} className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span className="text-[var(--navy-dark)]">
                <span className="font-semibold">{entry.username}</span> {entry.message}
                {entry.via_ai && (
                  <span className="ml-2 rounded-full bg-[var(--secondary-purple)]/10 px-2 py-0.5 text-[11px] font-semibold text-[var(--secondary-purple)]">
                    with AI
                  </span>
                )}
              </span>
              <span className="text-xs text-[var(--gray-text)]">{formatTimestamp(entry.created_at)}</span>
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
          {error}
        </p>
      )}
    </section>
  );
};
