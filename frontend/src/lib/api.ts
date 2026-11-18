import type { BoardData } from "@/lib/kanban";

export const getCurrentUser = async (): Promise<string | null> => {
  const response = await fetch("/api/me");
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return data.username;
};

export const login = async (username: string, password: string) => {
  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  return response.ok;
};

export const logout = async () => {
  await fetch("/api/logout", { method: "POST" });
};

// The version goes up by one on every save; saves must say which version they are based on.
export type VersionedBoard = { version: number; board: BoardData };

export const getBoard = async (): Promise<VersionedBoard> => {
  const response = await fetch("/api/board");
  return response.json();
};

export type ChatMessage = { role: "user" | "assistant"; content: string };

// `board` is null when the AI made no changes.
export const sendChat = async (
  message: string,
  history: ChatMessage[]
): Promise<{ reply: string; board: BoardData | null; version: number }> => {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
  });
  if (!response.ok) {
    throw new Error(`Chat request failed with ${response.status}`);
  }
  return response.json();
};

export type SaveResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number; board: BoardData } // the board changed elsewhere
  | { status: "error" };

export const saveBoard = async (board: BoardData, version: number): Promise<SaveResult> => {
  try {
    const response = await fetch("/api/board", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version, board }),
    });
    if (response.ok) {
      const saved: VersionedBoard = await response.json();
      return { status: "saved", version: saved.version };
    }
    if (response.status === 409) {
      const current: VersionedBoard = await response.json();
      return { status: "conflict", version: current.version, board: current.board };
    }
  } catch {
    // Network error: the server could not be reached.
  }
  return { status: "error" };
};
