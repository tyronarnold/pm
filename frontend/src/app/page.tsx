"use client";

import { useEffect, useState } from "react";
import { KanbanBoard } from "@/components/KanbanBoard";
import { LoginForm } from "@/components/LoginForm";
import { getBoard, getCurrentUser, login, logout } from "@/lib/api";
import type { BoardData } from "@/lib/kanban";

type AuthState = "loading" | "signed-out" | "signed-in";

export default function Home() {
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [board, setBoard] = useState<BoardData | null>(null);

  useEffect(() => {
    getCurrentUser().then((username) =>
      setAuthState(username ? "signed-in" : "signed-out")
    );
  }, []);

  useEffect(() => {
    if (authState === "signed-in") {
      getBoard().then(setBoard);
    }
  }, [authState]);

  const handleLogin = async (username: string, password: string) => {
    const ok = await login(username, password);
    if (ok) {
      setAuthState("signed-in");
    }
    return ok;
  };

  const handleLogout = async () => {
    await logout();
    setBoard(null);
    setAuthState("signed-out");
  };

  if (authState === "loading") {
    return null;
  }
  if (authState === "signed-out") {
    return <LoginForm onLogin={handleLogin} />;
  }
  if (!board) {
    return (
      <p className="p-12 text-center text-sm text-[var(--gray-text)]">
        Loading board...
      </p>
    );
  }
  return <KanbanBoard initialBoard={board} onLogout={handleLogout} />;
}
