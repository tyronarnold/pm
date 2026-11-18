# Frontend

Next.js 16 (App Router), React 19, Tailwind CSS 4, TypeScript 6.0. Drag and drop uses `@dnd-kit`. Built as a static export (`output: "export"` writes to `out/`), which the Docker image copies into the backend and FastAPI serves at `/`. The board is loaded from and saved to the backend (`/api/board`).

## Commands

```
npm run dev          dev server on http://localhost:3000 (no backend, so sign-in does not work there; use the container)
npm run build        static export to out/
npm run lint         eslint
npm run test:unit    vitest (jsdom)
npm run test:e2e     playwright against the running container on http://127.0.0.1:8000 (start it with scripts/start.*); resets the saved board of `user`; the chat test calls the real AI
```

## Code

- `src/app/layout.tsx`: root layout, loads fonts (Space Grotesk for display, Manrope for body)
- `src/app/page.tsx`: client component; checks `/api/me` on load, then shows `LoginForm` (signed out) or loads the board with `getBoard` and shows `KanbanBoard` (signed in); renders nothing while checking and "Loading board..." while loading
- `src/lib/api.ts`: `getCurrentUser`, `login`, `logout`, `getBoard`, `saveBoard`, `sendChat` (throws on a non-OK response) (fetch calls to the backend, same-origin cookie)
- `src/components/LoginForm.tsx`: username / password form, shows an error on bad credentials
- `src/app/globals.css`: Tailwind import and CSS variables for the color scheme (`--accent-yellow`, `--primary-blue`, `--secondary-purple`, `--navy-dark`, `--gray-text`), plus header styling (`--nav-chip` for the column name chips, `--logout` for the Log out button) and board styling (`--column-surface`, `--badge`, `--card-text`, `--add-card`, and one card color per column: `--card-backlog`, `--card-discovery`, `--card-progress`, `--card-review`, `--card-done`)
- `src/lib/kanban.ts`: types (`Card`, `Column`, `BoardData`), `columnColors` (column id to card background variable), `initialData` (5 columns, 8 sample cards; the backend holds the same default board, so this is only used by tests), `moveCard` (reorder within or move across columns), `createId`
- `src/components/KanbanBoard.tsx`: client component holding board state (starts from the `initialBoard` prop). Every change updates state and then saves the whole board (`saveBoard`); column renames update state on each keystroke but save only on blur / Enter (`onRenameDone`). A failed save shows an error in the header until the next successful save. Header has a Log out button (`onLogout` prop); `DndContext` (given a `useId` id so server and client markup match), handlers for drag end, column rename, add, edit and delete card
- `src/components/ChatSidebar.tsx`: AI chat. Keeps the conversation in state (lost on reload) and sends it as `history` with each message to `/api/chat`; shows "Thinking..." while waiting and an error if the request fails; passes the returned board to `onBoardUpdate`. Can be hidden and shown. `KanbanBoard` renders it beside the board at `2xl` (1536px+) and full width below the board on smaller screens, and passes `setBoard` (the backend has already saved the AI's board, so it is not saved again)
- `src/components/KanbanColumn.tsx`: droppable column (yellow top border) with an uppercase editable title input (blur or Enter calls `onRenameDone`), a card count badge, sortable card list, `NewCardForm`
- `src/components/KanbanCard.tsx`: sortable card colored by its column (`color` prop), with title, details, and edit (pencil) and delete (X) icon buttons in the top-right corner. On devices with a mouse the icons and a yellow left edge appear on hover or keyboard focus (`pointer-fine:` variants); on touch screens the icons are always shown. Edit swaps in an inline form (title required); while editing, dragging is disabled and dnd-kit's `attributes` are not applied, so the form is not inside an `aria-disabled` "button"
- `src/components/KanbanCardPreview.tsx`: card shown in the drag overlay (same color and shared `cardClassName`)
- `src/components/NewCardForm.tsx`: full-width blue "+ Add card" button that opens a form to add a card (title required)

## Data shape

```ts
BoardData = {
  columns: { id: string; title: string; cardIds: string[] }[];
  cards: Record<string, { id: string; title: string; details: string }>;
}
```

Columns are fixed (no add or remove); only their titles change. Card order is the order of `cardIds`.

## Tests

- `src/lib/kanban.test.ts`: `moveCard` unit tests
- `src/components/KanbanBoard.test.tsx`: `fetch` stubbed; checks the board sent by each `PUT` for rename (on blur and Enter, not per keystroke), add, remove and edit; cancel and empty title do not save; save errors shown and cleared; a board returned by the chat updates the columns without another save
- `src/components/ChatSidebar.test.tsx`: `fetch` stubbed; message and reply shown, history sent with the next message, returned board passed on, loading indicator, error, hide / show
- `src/app/page.test.tsx`: sign-in flow with `fetch` stubbed (signed out, already signed in, board rendered from the API response, valid and invalid credentials, log out)
- `tests/kanban.spec.ts`: Playwright e2e (signs in and resets the board first) for load, add card, drag a card between columns, edit card, rename column, every change kept after reload, no console errors on load
- `tests/chat.spec.ts`: calls the real AI through the container: asks it to create a card and move it to Done, checks the card appears in Done without a reload and is still there after one
- `tests/auth.spec.ts`: Playwright e2e for login form, bad credentials, sign in, reload keeps session, log out, 401 from `/api/me`
- `tests/helpers.ts`: `signIn(page)`, `resetBoard(page)` (saves `initialData` as the board), `saved(page, action)` (waits for the board save an action triggers)
- Playwright's `getByLabel` matches substrings case-insensitively, so use `{ exact: true }` for "Message" (otherwise it also matches the "Chat messages" log)
- Playwright runs with `workers: 1` because every test shares the one saved board of `user`
- On Windows, run Vitest from a path with an uppercase drive letter (`C:\...`, which PowerShell and cmd give you). Git Bash's `/c/...` gives Node a lowercase `c:\`, Vitest is then loaded twice, and the global `expect` lacks the jest-dom matchers ("Invalid Chai property")
- Next.js renders a hidden route announcer with `role="alert"`, so in e2e tests find messages by text, not by the alert role
- Vitest setup: `src/test/setup.ts` imports `@testing-library/jest-dom/vitest`; `src/test/vitest.d.ts` references the Vitest globals and jest-dom matcher types
