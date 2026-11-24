import { initialData, type BoardData } from "@/lib/kanban";

// An in-memory stand-in for the backend API, for component tests that go through
// several requests (sign in, list boards, open, create, rename, delete, save).
// It follows the backend's rules closely enough for the frontend: sessions, owners,
// versions and 409 conflicts are not modelled beyond what the tests need.

type StoredBoard = { id: number; name: string; version: number; board: BoardData };

export const emptyBoard: BoardData = {
  columns: initialData.columns.map((column) => ({ ...column, cardIds: [] })),
  cards: {},
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export const createFakeServer = ({ signedIn = true } = {}) => {
  const state = {
    user: (signedIn ? "user" : null) as string | null,
    passwords: new Map([["user", "password"]]),
    boards: [{ id: 1, name: "My first board", version: 1, board: initialData }] as StoredBoard[],
    nextId: 2,
  };

  const summary = ({ id, name }: StoredBoard) => ({ id, name, updated_at: "2026-01-01 00:00:00" });

  const handle = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body as string) : undefined;

    if (url === "/api/login") {
      if (state.passwords.get(body.username) !== body.password) {
        return json({ detail: "Invalid username or password." }, 401);
      }
      state.user = body.username;
      return json({ username: body.username });
    }
    if (url === "/api/register") {
      if (state.passwords.has(body.username)) {
        return json({ detail: "That username is already taken." }, 409);
      }
      state.passwords.set(body.username, body.password);
      state.user = body.username;
      return json({ username: body.username }, 201);
    }
    if (url === "/api/logout") {
      state.user = null;
      return json({ status: "ok" });
    }
    if (!state.user) {
      return json({ detail: "Not signed in" }, 401);
    }
    if (url === "/api/me" && method === "GET") {
      return json({ username: state.user });
    }
    if (url === "/api/me/password") {
      if (state.passwords.get(state.user) !== body.current_password) {
        return json({ detail: "That password is not correct." }, 403);
      }
      state.passwords.set(state.user, body.new_password);
      return json({ status: "ok" });
    }
    if (url === "/api/me" && method === "DELETE") {
      if (state.passwords.get(state.user) !== body.password) {
        return json({ detail: "That password is not correct." }, 403);
      }
      state.passwords.delete(state.user);
      state.user = null;
      return new Response(null, { status: 204 });
    }
    if (url === "/api/boards") {
      if (method === "POST") {
        const created = { id: state.nextId++, name: body.name, version: 1, board: emptyBoard };
        state.boards.push(created);
        return json(created, 201);
      }
      return json(state.boards.map(summary));
    }

    const match = url.match(/^\/api\/boards\/(\d+)(\/chat)?$/);
    const stored = match && state.boards.find((board) => board.id === Number(match[1]));
    if (!stored) {
      return json({ detail: "Board not found" }, 404);
    }
    if (match[2]) {
      return json({ reply: "Noted.", board: null, version: stored.version });
    }
    if (method === "GET") {
      return json(stored);
    }
    if (method === "PATCH") {
      stored.name = body.name;
      return json(summary(stored));
    }
    if (method === "DELETE") {
      state.boards = state.boards.filter((board) => board !== stored);
      return new Response(null, { status: 204 });
    }
    // PUT: save the board.
    if (body.version !== stored.version) {
      return json({ detail: "Board changed since this version", version: stored.version, board: stored.board }, 409);
    }
    stored.version += 1;
    stored.board = body.board;
    return json({ version: stored.version, board: stored.board });
  };

  const fetchMock = vi.fn(handle);
  vi.stubGlobal("fetch", fetchMock);
  return { state, fetchMock, handle };
};
