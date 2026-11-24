import type { components } from "@/lib/api-types";
import type { BoardData } from "@/lib/kanban";

// Request and response shapes generated from the backend (`npm run api:types`).
type Schemas = components["schemas"];
// The version goes up by one on every save; saves must say which version they are based on.
export type VersionedBoard = Schemas["VersionedBoard"];
export type BoardDetail = Schemas["BoardDetail"];
export type BoardSummary = Schemas["BoardSummary"];
export type ChatMessage = Schemas["ChatMessage"];
type ChatRequest = Schemas["ChatRequest"];
type ChatResponse = Schemas["ChatResponse"];
type Credentials = Schemas["Credentials"];
type NewAccount = Schemas["NewAccount"];
type PasswordChange = Schemas["PasswordChange"];
type PasswordConfirmation = Schemas["PasswordConfirmation"];
type BoardName = Schemas["BoardName"];
type NewMember = Schemas["NewMember"];
export type Account = Schemas["Account"];
export type UserInfo = Schemas["UserInfo"];
type RoleChange = Schemas["RoleChange"];
type PasswordReset = Schemas["PasswordReset"];

const send = (url: string, method: string, body?: unknown) =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// The server's `detail` when it is a message (validation errors are a list), else the fallback.
const errorMessage = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
};

// Throws if the request failed, so callers can show a load error.
const ok = (response: Response, what: string) => {
  if (!response.ok) {
    throw new Error(`${what} failed with ${response.status}`);
  }
  return response;
};

// Accounts. Each action returns null on success, or a message for the user.

// The signed-in account, or null when signed out. Throws if the server cannot be reached.
export const getCurrentUser = async (): Promise<Account | null> => {
  const response = await fetch("/api/me");
  return response.ok ? response.json() : null;
};

export const login = async (username: string, password: string): Promise<string | null> => {
  const response = await send("/api/login", "POST", { username, password } satisfies Credentials);
  return response.ok ? null : errorMessage(response, "Invalid username or password.");
};

export const ACCOUNT_RULES =
  "Usernames are 3-32 lowercase letters, digits, dots, dashes or underscores. Passwords need at least 8 characters.";

export const register = async (username: string, password: string): Promise<string | null> => {
  const response = await send("/api/register", "POST", { username, password } satisfies NewAccount);
  return response.ok ? null : errorMessage(response, ACCOUNT_RULES);
};

export const logout = async () => {
  await fetch("/api/logout", { method: "POST" });
};

export const changePassword = async (current: string, next: string): Promise<string | null> => {
  const response = await send("/api/me/password", "PUT", {
    current_password: current,
    new_password: next,
  } satisfies PasswordChange);
  return response.ok ? null : errorMessage(response, "Passwords need at least 8 characters.");
};

export const deleteAccount = async (password: string): Promise<string | null> => {
  const response = await send("/api/me", "DELETE", { password } satisfies PasswordConfirmation);
  return response.ok ? null : errorMessage(response, "Could not delete the account.");
};

// Boards. These throw if the request fails.

export const listBoards = async (): Promise<BoardSummary[]> =>
  ok(await fetch("/api/boards"), "Loading the boards").json();

export const getBoard = async (id: number): Promise<BoardDetail> =>
  ok(await fetch(`/api/boards/${id}`), "Loading the board").json();

export const createBoard = async (name: string): Promise<BoardDetail> =>
  ok(await send("/api/boards", "POST", { name } satisfies BoardName), "Creating the board").json();

export const renameBoard = async (id: number, name: string): Promise<BoardSummary> =>
  ok(await send(`/api/boards/${id}`, "PATCH", { name } satisfies BoardName), "Renaming the board").json();

export const deleteBoard = async (id: number): Promise<void> => {
  ok(await fetch(`/api/boards/${id}`, { method: "DELETE" }), "Deleting the board");
};

// Members of a shared board (usernames, not including the owner).

export const listMembers = async (boardId: number): Promise<string[]> =>
  ok(await fetch(`/api/boards/${boardId}/members`), "Loading the members").json();

// Returns null on success, or a message for the user (no such user, already a member).
export const addMember = async (boardId: number, username: string): Promise<string | null> => {
  const response = await send(`/api/boards/${boardId}/members`, "POST", { username } satisfies NewMember);
  return response.ok ? null : errorMessage(response, "Could not share the board.");
};

// The owner removes a member, or a member removes themselves (leaves the board). Throws on failure.
export const removeMember = async (boardId: number, username: string): Promise<void> => {
  ok(
    await fetch(`/api/boards/${boardId}/members/${encodeURIComponent(username)}`, { method: "DELETE" }),
    "Removing the member"
  );
};

// Administration (admins only). Actions return null on success, or a message for the user.

export const listUsers = async (): Promise<UserInfo[]> =>
  ok(await fetch("/api/admin/users"), "Loading the users").json();

const userUrl = (username: string) => `/api/admin/users/${encodeURIComponent(username)}`;

export const setAdmin = async (username: string, isAdmin: boolean): Promise<string | null> => {
  const response = await send(userUrl(username), "PATCH", { is_admin: isAdmin } satisfies RoleChange);
  return response.ok ? null : errorMessage(response, "Could not change the role.");
};

export const resetPassword = async (username: string, password: string): Promise<string | null> => {
  const response = await send(`${userUrl(username)}/password`, "PUT", {
    new_password: password,
  } satisfies PasswordReset);
  return response.ok ? null : errorMessage(response, "Passwords need at least 8 characters.");
};

export const deleteUser = async (username: string): Promise<string | null> => {
  const response = await fetch(userUrl(username), { method: "DELETE" });
  return response.ok ? null : errorMessage(response, "Could not delete the user.");
};

const CHAT_UNAVAILABLE = "The assistant could not be reached. Please try again.";

// `board` is null when the AI made no changes. On failure, throws an Error whose
// message can be shown to the user (the server's `detail` when it sends one).
export const sendChat = async (
  boardId: number,
  message: string,
  history: ChatMessage[]
): Promise<ChatResponse> => {
  let response: Response;
  try {
    response = await send(`/api/boards/${boardId}/chat`, "POST", { message, history } satisfies ChatRequest);
  } catch {
    throw new Error(CHAT_UNAVAILABLE);
  }
  if (!response.ok) {
    throw new Error(await errorMessage(response, CHAT_UNAVAILABLE));
  }
  return response.json();
};

export type SaveResult =
  | { status: "saved"; version: number }
  | { status: "conflict"; version: number; board: BoardData } // the board changed elsewhere
  | { status: "error" };

export const saveBoard = async (
  boardId: number,
  board: BoardData,
  version: number
): Promise<SaveResult> => {
  try {
    const response = await send(`/api/boards/${boardId}`, "PUT", { version, board } satisfies VersionedBoard);
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
