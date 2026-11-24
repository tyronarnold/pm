import type { ActivityEntry } from "@/lib/api";
import { initialData, isOverdue, localToday, type BoardData } from "@/lib/kanban";

// An in-memory stand-in for the backend API, for component tests that go through
// several requests (sign in, list boards, open, create, rename, delete, save, share).
// It follows the backend's rules closely enough for the frontend: versions and 409s,
// owners and members (boards without an `owner` belong to "user"). Activity is whatever
// a test puts in `state.activity`.

type StoredBoard = {
  id: number;
  name: string;
  version: number;
  board: BoardData;
  owner?: string;
  members?: string[];
};

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
    admins: new Set(["user"]),
    boards: [{ id: 1, name: "My first board", version: 1, board: initialData }] as StoredBoard[],
    nextId: 2,
    activity: {} as Record<number, ActivityEntry[]>,
  };

  const ownerOf = (board: StoredBoard) => board.owner ?? "user";
  const membersOf = (board: StoredBoard) => (board.members ??= []);
  const visible = () =>
    state.boards.filter((board) => ownerOf(board) === state.user || membersOf(board).includes(state.user!));
  const forbidden = () => json({ detail: "Only the board's owner can do that." }, 403);

  const summary = (stored: StoredBoard) => {
    const { id, name, board } = stored;
    const done = board.columns.at(-1)?.cardIds ?? [];
    return {
      id,
      name,
      owner: ownerOf(stored),
      updated_at: "2026-01-01 00:00:00",
      cards: Object.keys(board.cards).length,
      done: done.length,
      overdue: Object.values(board.cards).filter((card) => !done.includes(card.id) && isOverdue(card, localToday()))
        .length,
      mine: Object.values(board.cards).filter((card) => !done.includes(card.id) && card.assignee === state.user)
        .length,
    };
  };

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
      // Like the backend, a new account starts with a board of sample cards.
      state.boards.push({ id: state.nextId++, name: "My first board", version: 1, board: initialData, owner: body.username });
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
      return json({ username: state.user, is_admin: state.admins.has(state.user) });
    }
    const adminMatch = url.match(/^\/api\/admin\/users(?:\/([^/]+))?(\/password)?$/);
    if (adminMatch) {
      if (!state.admins.has(state.user)) {
        return json({ detail: "Only admins can do that." }, 403);
      }
      const name = adminMatch[1] && decodeURIComponent(adminMatch[1]);
      if (!name) {
        return json(
          [...state.passwords.keys()].sort().map((username) => ({
            username,
            is_admin: state.admins.has(username),
            created_at: "2026-01-02 12:00:00", // midday UTC: Jan 2 in nearly every time zone
            boards: state.boards.filter((board) => ownerOf(board) === username).length,
          }))
        );
      }
      if (!state.passwords.has(name)) {
        return json({ detail: "No such user." }, 404);
      }
      if (adminMatch[2]) {
        state.passwords.set(name, body.new_password);
        return json({ status: "ok" });
      }
      if (method === "PATCH") {
        if (!body.is_admin && state.admins.has(name) && state.admins.size === 1) {
          return json({ detail: "There must be at least one admin." }, 409);
        }
        if (body.is_admin) state.admins.add(name);
        else state.admins.delete(name);
        return json({ username: name, is_admin: body.is_admin });
      }
      state.passwords.delete(name);
      state.admins.delete(name);
      state.boards = state.boards.filter((board) => ownerOf(board) !== name);
      return new Response(null, { status: 204 });
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
        const created = {
          id: state.nextId++,
          name: body.name,
          version: 1,
          board: emptyBoard,
          owner: state.user!,
          members: [],
        };
        state.boards.push(created);
        return json(created, 201);
      }
      return json(visible().map(summary));
    }

    const match = url.match(/^\/api\/boards\/(\d+)(\/chat|\/members|\/activity)?(?:\/(.+))?$/);
    const stored = match && visible().find((board) => board.id === Number(match[1]));
    if (!stored) {
      return json({ detail: "Board not found" }, 404);
    }
    const isOwner = ownerOf(stored) === state.user;
    if (match[2] === "/activity") {
      return json(state.activity[stored.id] ?? []);
    }
    if (match[2] === "/chat") {
      return json({ reply: "Noted.", board: null, version: stored.version });
    }
    if (match[2] === "/members") {
      const members = membersOf(stored);
      if (method === "GET") {
        return json(members);
      }
      if (method === "POST") {
        if (!isOwner) return forbidden();
        if (!state.passwords.has(body.username)) {
          return json({ detail: `There is no user called "${body.username}".` }, 422);
        }
        if (body.username === state.user || members.includes(body.username)) {
          return json({ detail: `${body.username} is already a member.` }, 409);
        }
        members.push(body.username);
        return json(members, 201);
      }
      const username = decodeURIComponent(match[3]);
      if (!isOwner && username !== state.user) return forbidden();
      stored.members = members.filter((member) => member !== username);
      return new Response(null, { status: 204 });
    }
    if (method === "GET") {
      return json({ ...stored, owner: ownerOf(stored), members: membersOf(stored) });
    }
    if (method === "PATCH") {
      if (!isOwner) return forbidden();
      stored.name = body.name;
      return json(summary(stored));
    }
    if (method === "DELETE") {
      if (!isOwner) return forbidden();
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
