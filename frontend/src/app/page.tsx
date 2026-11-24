"use client";

import { useEffect, useState } from "react";
import { LoginForm } from "@/components/LoginForm";
import { Workspace } from "@/components/Workspace";
import { getCurrentUser, login, logout, register } from "@/lib/api";

type View = "checking" | "signed-out" | "failed" | "signed-in";

export default function Home() {
  const [view, setView] = useState<View>("checking");
  const [username, setUsername] = useState("");
  // Bumped to run the sign-in check again (after signing in, or on "Try again").
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const check = async () => {
      try {
        const name = await getCurrentUser();
        setUsername(name ?? "");
        setView(name ? "signed-in" : "signed-out");
      } catch {
        setView("failed");
      }
    };
    check();
  }, [attempt]);

  const recheck = () => setAttempt((count) => count + 1);

  // Sign in or register, then load the workspace. Resolves to an error message, if any.
  const enter = (action: typeof login) => async (name: string, password: string) => {
    const error = await action(name, password);
    if (!error) {
      recheck();
    }
    return error;
  };

  const handleLogout = async () => {
    await logout();
    setView("signed-out");
  };

  if (view === "checking") {
    return null;
  }
  if (view === "signed-out") {
    return <LoginForm onLogin={enter(login)} onRegister={enter(register)} />;
  }
  if (view === "failed") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-sm font-semibold text-[var(--secondary-purple)]">
          Could not reach the server. Check that it is running.
        </p>
        <button
          type="button"
          onClick={recheck}
          className="rounded-full bg-[var(--secondary-purple)] px-5 py-2 text-xs font-semibold uppercase tracking-wide text-white transition hover:brightness-110"
        >
          Try again
        </button>
      </main>
    );
  }
  return (
    <Workspace
      key={username}
      username={username}
      onLogout={handleLogout}
      onAccountDeleted={() => setView("signed-out")}
    />
  );
}
