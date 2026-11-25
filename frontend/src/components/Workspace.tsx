"use client";

import { useEffect, useState } from "react";
import { AccountPanel } from "@/components/AccountPanel";
import { ActivityPanel } from "@/components/ActivityPanel";
import { AdminPanel } from "@/components/AdminPanel";
import { BoardBar } from "@/components/BoardBar";
import { KanbanBoard } from "@/components/KanbanBoard";
import { OverviewPanel } from "@/components/OverviewPanel";
import { SharePanel } from "@/components/SharePanel";
import {
  createBoard,
  deleteBoard,
  getBoard,
  listBoards,
  renameBoard,
  type BoardDetail,
  type BoardSummary,
} from "@/lib/api";

type WorkspaceProps = {
  username: string;
  isAdmin: boolean;
  onLogout: () => void;
  onAccountDeleted: () => void;
};

type Status = "loading" | "failed" | "ready";

// The open board is kept in the URL (`?board=<id>`), so a reload stays on it.
const boardInUrl = () => Number(new URLSearchParams(window.location.search).get("board"));

const showInUrl = (id: number | undefined) =>
  window.history.replaceState(null, "", id ? `?board=${id}` : window.location.pathname);

const ACTION_FAILED = "That did not work. Check that the server is running and try again.";

export const Workspace = ({ username, isAdmin, onLogout, onAccountDeleted }: WorkspaceProps) => {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [current, setCurrent] = useState<BoardDetail | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [actionError, setActionError] = useState<string | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [showSharing, setShowSharing] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showActivity, setShowActivity] = useState(false);
  const [showOverview, setShowOverview] = useState(false);
  // Bumped by "Try again" to load everything again.
  const [attempt, setAttempt] = useState(0);

  // Loads the board list, then opens `id` if it is in it, or else the first board.
  const open = async (id?: number) => {
    const list = await listBoards();
    const next = list.find((board) => board.id === id) ?? list[0];
    setBoards(list);
    setCurrent(next ? await getBoard(next.id) : null);
    showInUrl(next?.id);
  };

  useEffect(() => {
    const load = async () => {
      try {
        await open(boardInUrl());
        setStatus("ready");
      } catch {
        setStatus("failed");
      }
    };
    load();
  }, [attempt]);

  // Runs a board action; a failure leaves the open board as it was and shows a message.
  const act = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
    } catch {
      setActionError(ACTION_FAILED);
    }
  };

  const handleSelect = (id: number) => act(() => open(id));

  const handleCreate = (name: string) => act(async () => open((await createBoard(name)).id));

  const handleRename = (name: string) =>
    act(async () => {
      if (!current) return;
      await renameBoard(current.id, name);
      setBoards(await listBoards());
      setCurrent({ ...current, name });
    });

  const handleDelete = () =>
    act(async () => {
      if (!current || !window.confirm(`Delete the board "${current.name}" and all its cards?`)) return;
      await deleteBoard(current.id);
      await open();
    });

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute left-0 top-0 h-[420px] w-[420px] -translate-x-1/3 -translate-y-1/3 rounded-full bg-[radial-gradient(circle,_rgba(32,157,215,0.25)_0%,_rgba(32,157,215,0.05)_55%,_transparent_70%)]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[520px] w-[520px] translate-x-1/4 translate-y-1/4 rounded-full bg-[radial-gradient(circle,_rgba(117,57,145,0.18)_0%,_rgba(117,57,145,0.05)_55%,_transparent_75%)]" />

      <main className="relative mx-auto flex min-h-screen max-w-[1800px] flex-col gap-8 px-6 pb-16 pt-12">
        <header className="flex flex-col gap-6 rounded-[32px] border border-[var(--stroke)] bg-white/80 p-8 shadow-[var(--shadow)] backdrop-blur">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.35em] text-[var(--gray-text)]">
                Project boards
              </p>
              <h1 className="mt-3 font-display text-4xl font-semibold text-[var(--navy-dark)]">
                Kanban Studio
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[var(--gray-text)]">
                Keep momentum visible. Plan each project on its own board, drag cards between
                stages, and ask the AI assistant to do the busywork.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-[var(--gray-text)]">
                Signed in as <span className="font-semibold text-[var(--navy-dark)]">{username}</span>
              </p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setShowAdmin((shown) => !shown)}
                  aria-expanded={showAdmin}
                  className="rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--secondary-purple)] transition hover:text-[var(--navy-dark)]"
                >
                  Admin
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAccount((shown) => !shown)}
                aria-expanded={showAccount}
                className="rounded-full border border-[var(--stroke)] bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--primary-blue)] transition hover:text-[var(--navy-dark)]"
              >
                Account
              </button>
              <button
                type="button"
                onClick={onLogout}
                className="rounded-full bg-[var(--logout)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
              >
                Log out
              </button>
            </div>
          </div>
          {status === "ready" && (
            <BoardBar
              boards={boards}
              current={current}
              username={username}
              onShare={() => setShowSharing((shown) => !shown)}
              onActivity={() => setShowActivity((shown) => !shown)}
              onOverview={() => setShowOverview((shown) => !shown)}
              onSelect={handleSelect}
              onCreate={handleCreate}
              onRename={handleRename}
              onDelete={handleDelete}
            />
          )}
          {actionError && (
            <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
              {actionError}
            </p>
          )}
        </header>

        {showAccount && (
          <AccountPanel onClose={() => setShowAccount(false)} onDeleted={onAccountDeleted} />
        )}

        {showAdmin && <AdminPanel username={username} onClose={() => setShowAdmin(false)} />}

        {showOverview && (
          <OverviewPanel
            username={username}
            onOpen={(id) => {
              setShowOverview(false);
              handleSelect(id);
            }}
            onClose={() => setShowOverview(false)}
          />
        )}

        {showActivity && current && (
          <ActivityPanel
            key={`activity-${current.id}`}
            boardId={current.id}
            onClose={() => setShowActivity(false)}
          />
        )}

        {showSharing && current && (
          // Keyed by board, so switching boards loads that board's members. Keys must differ
          // from the KanbanBoard's: siblings with the same key confuse React.
          <SharePanel
            key={`sharing-${current.id}`}
            boardId={current.id}
            owner={current.owner}
            username={username}
            onLeave={() => {
              setShowSharing(false);
              act(() => open());
            }}
            // Only for the board this panel belongs to: a share can finish after switching boards.
            onMembersChange={(members) =>
              setCurrent((open) => (open?.id === current.id ? { ...open, members } : open))
            }
            onClose={() => setShowSharing(false)}
          />
        )}

        {status === "loading" && (
          <p className="p-12 text-center text-sm text-[var(--gray-text)]">Loading board...</p>
        )}
        {status === "failed" && (
          <div className="flex flex-col items-center gap-4 p-12 text-center">
            <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
              Could not load your board. Check that the server is running.
            </p>
            <button
              type="button"
              onClick={() => {
                setStatus("loading");
                setAttempt((count) => count + 1);
              }}
              className="rounded-full bg-[var(--secondary-purple)] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
            >
              Try again
            </button>
          </div>
        )}
        {status === "ready" && !current && (
          <p className="p-12 text-center text-sm text-[var(--gray-text)]">
            You have no boards yet. Create one with &quot;New board&quot; to get started.
          </p>
        )}
        {status === "ready" && current && (
          // Keyed by board, so switching boards starts with fresh board and chat state.
          <KanbanBoard
            key={`board-${current.id}`}
            boardId={current.id}
            initialBoard={current.board}
            initialVersion={current.version}
            people={[current.owner, ...current.members]}
            username={username}
          />
        )}
      </main>
    </div>
  );
};
