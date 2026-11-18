"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { LoginForm } from "@/components/LoginForm";
import { getBoard, getCurrentUser, login, logout, type VersionedBoard } from "@/lib/api";

type View = "checking" | "signed-out" | "loading-board" | "load-failed" | "ready";

export default function Home() {
  const [view, setView] = useState<View>("checking");
  const [board, setBoard] = useState<VersionedBoard | null>(null);
  // Bumped to run the sign-in check and board load again (after signing in, or on "Try again").
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        if (!(await getCurrentUser())) {
          setView("signed-out");
          return;
        }
        setView("loading-board");
        setBoard(await getBoard());
        setView("ready");
      } catch {
        setView("load-failed");
      }
    };
    load();
  }, [attempt]);

  const reload = () => {
    setView("loading-board");
    setAttempt((count) => count + 1);
  };

  const handleLogin = async (username: string, password: string) => {
    const error = await login(username, password);
    if (!error) {
      reload();
    }
    return error;
  };

  const handleLogout = async () => {
    await logout();
    setBoard(null);
    setView("signed-out");
  };

  if (view === "checking") {
    return null;
  }
  if (view === "signed-out") {
    return <LoginForm onLogin={handleLogin} />;
  }
  if (view === "load-failed") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
          Could not load your board. Check that the server is running.
        </p>
        <button
          type="button"
          onClick={reload}
          className="rounded-full bg-[var(--secondary-purple)] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          Try again
        </button>
      </main>
    );
  }
  if (view === "loading-board" || !board) {
    return (
      <p className="p-12 text-center text-sm text-[var(--gray-text)]">
        Loading board...
      </p>
    );
  }
  return (
    <KanbanBoard
      initialBoard={board.board}
      initialVersion={board.version}
      onLogout={handleLogout}
    />
  );
}
