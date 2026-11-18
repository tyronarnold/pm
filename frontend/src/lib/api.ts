import type { components } from "@/lib/api-types";
import type { BoardData } from "@/lib/kanban";

// Request and response shapes generated from the backend (`npm run api:types`).
type Schemas = components["schemas"];
// The version goes up by one on every save; saves must say which version they are based on.
export type VersionedBoard = Schemas["VersionedBoard"];
export type ChatMessage = Schemas["ChatMessage"];
type ChatRequest = Schemas["ChatRequest"];
type ChatResponse = Schemas["ChatResponse"];
type Credentials = Schemas["Credentials"];

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
    body: JSON.stringify({ username, password } satisfies Credentials),
  });
  return response.ok;
};

export const logout = async () => {
  await fetch("/api/logout", { method: "POST" });
};

// Throws if the board could not be loaded.
export const getBoard = async (): Promise<VersionedBoard> => {
  const response = await fetch("/api/board");
  if (!response.ok) {
    throw new Error(`Loading the board failed with ${response.status}`);
  }
  return response.json();
};

const CHAT_UNAVAILABLE = "The assistant could not be reached. Please try again.";

// `board` is null when the AI made no changes. On failure, throws an Error whose
// message can be shown to the user (the server's `detail` when it sends one).
export const sendChat = async (
  message: string,
  history: ChatMessage[]
): Promise<ChatResponse> => {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, history } satisfies ChatRequest),
    });
  } catch {
    throw new Error(CHAT_UNAVAILABLE);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.detail === "string" ? body.detail : CHAT_UNAVAILABLE);
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
      body: JSON.stringify({ version, board } satisfies VersionedBoard),
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
