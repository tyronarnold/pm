import type { components } from "@/lib/api-types";

// Generated from the backend's Pydantic models (`npm run api:types`), so they cannot drift apart.
export type Card = components["schemas"]["Card"];
export type Column = components["schemas"]["Column"];
export type BoardData = components["schemas"]["Board"];
// Everything about a card except its id: what the card forms edit.
export type CardFields = Omit<Card, "id">;
export type Priority = NonNullable<Card["priority"]>;

export const priorities: Priority[] = ["high", "medium", "low"];

// Card background by column position, repeating after five columns
// (the standard Backlog ... Done columns keep their colors).
const cardColors = [
  "var(--card-backlog)",
  "var(--card-discovery)",
  "var(--card-progress)",
  "var(--card-review)",
  "var(--card-done)",
];

export const columnColor = (index: number) => cardColors[index % cardColors.length];

const sampleCard = (id: string, title: string, details: string): Card => ({
  id,
  title,
  details,
  priority: null,
  dueDate: null,
  labels: [],
});

// The same board the backend gives a new account (as the server returns it).
export const initialData: BoardData = {
  columns: [
    { id: "col-backlog", title: "Backlog", cardIds: ["card-1", "card-2"] },
    { id: "col-discovery", title: "Discovery", cardIds: ["card-3"] },
    {
      id: "col-progress",
      title: "In Progress",
      cardIds: ["card-4", "card-5"],
    },
    { id: "col-review", title: "Review", cardIds: ["card-6"] },
    { id: "col-done", title: "Done", cardIds: ["card-7", "card-8"] },
  ],
  cards: {
    "card-1": sampleCard("card-1", "Align roadmap themes", "Draft quarterly themes with impact statements and metrics."),
    "card-2": sampleCard("card-2", "Gather customer signals", "Review support tags, sales notes, and churn feedback."),
    "card-3": sampleCard("card-3", "Prototype analytics view", "Sketch initial dashboard layout and key drill-downs."),
    "card-4": sampleCard("card-4", "Refine status language", "Standardize column labels and tone across the board."),
    "card-5": sampleCard("card-5", "Design card layout", "Add hierarchy and spacing for scanning dense lists."),
    "card-6": sampleCard("card-6", "QA micro-interactions", "Verify hover, focus, and loading states."),
    "card-7": sampleCard("card-7", "Ship marketing page", "Final copy approved and asset pack delivered."),
    "card-8": sampleCard("card-8", "Close onboarding sprint", "Document release notes and share internally."),
  },
};

const isColumnId = (columns: Column[], id: string) =>
  columns.some((column) => column.id === id);

const findColumnId = (columns: Column[], id: string) => {
  if (isColumnId(columns, id)) {
    return id;
  }
  return columns.find((column) => column.cardIds.includes(id))?.id;
};

export const moveCard = (
  columns: Column[],
  activeId: string,
  overId: string
): Column[] => {
  const activeColumnId = findColumnId(columns, activeId);
  const overColumnId = findColumnId(columns, overId);

  if (!activeColumnId || !overColumnId) {
    return columns;
  }

  const activeColumn = columns.find((column) => column.id === activeColumnId);
  const overColumn = columns.find((column) => column.id === overColumnId);

  if (!activeColumn || !overColumn) {
    return columns;
  }

  const isOverColumn = isColumnId(columns, overId);

  if (activeColumnId === overColumnId) {
    if (isOverColumn) {
      const nextCardIds = activeColumn.cardIds.filter(
        (cardId) => cardId !== activeId
      );
      nextCardIds.push(activeId);
      return columns.map((column) =>
        column.id === activeColumnId
          ? { ...column, cardIds: nextCardIds }
          : column
      );
    }

    const oldIndex = activeColumn.cardIds.indexOf(activeId);
    const newIndex = activeColumn.cardIds.indexOf(overId);

    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
      return columns;
    }

    const nextCardIds = [...activeColumn.cardIds];
    nextCardIds.splice(oldIndex, 1);
    nextCardIds.splice(newIndex, 0, activeId);

    return columns.map((column) =>
      column.id === activeColumnId
        ? { ...column, cardIds: nextCardIds }
        : column
    );
  }

  const activeIndex = activeColumn.cardIds.indexOf(activeId);
  if (activeIndex === -1) {
    return columns;
  }

  const nextActiveCardIds = [...activeColumn.cardIds];
  nextActiveCardIds.splice(activeIndex, 1);

  const nextOverCardIds = [...overColumn.cardIds];
  if (isOverColumn) {
    nextOverCardIds.push(activeId);
  } else {
    const overIndex = overColumn.cardIds.indexOf(overId);
    const insertIndex = overIndex === -1 ? nextOverCardIds.length : overIndex;
    nextOverCardIds.splice(insertIndex, 0, activeId);
  }

  return columns.map((column) => {
    if (column.id === activeColumnId) {
      return { ...column, cardIds: nextActiveCardIds };
    }
    if (column.id === overColumnId) {
      return { ...column, cardIds: nextOverCardIds };
    }
    return column;
  });
};

// Board updates. Each returns a new board and leaves the one passed in unchanged.

export const renameColumn = (board: BoardData, columnId: string, title: string): BoardData => ({
  ...board,
  columns: board.columns.map((column) =>
    column.id === columnId ? { ...column, title } : column
  ),
});

// Adds the card at the bottom of the column.
export const addCard = (board: BoardData, columnId: string, card: Card): BoardData => ({
  ...board,
  cards: { ...board.cards, [card.id]: card },
  columns: board.columns.map((column) =>
    column.id === columnId ? { ...column, cardIds: [...column.cardIds, card.id] } : column
  ),
});

export const editCard = (board: BoardData, cardId: string, fields: CardFields): BoardData => ({
  ...board,
  cards: { ...board.cards, [cardId]: { ...fields, id: cardId } },
});

// Adds the column after the last one.
export const addColumn = (board: BoardData, column: Column): BoardData => ({
  ...board,
  columns: [...board.columns, column],
});

// Only for empty columns: every card must stay in a column.
export const deleteColumn = (board: BoardData, columnId: string): BoardData => ({
  ...board,
  columns: board.columns.filter((column) => column.id !== columnId),
});

// Moves the column `offset` places (-1 = left, 1 = right); does nothing past either end.
export const moveColumn = (board: BoardData, columnId: string, offset: number): BoardData => {
  const from = board.columns.findIndex((column) => column.id === columnId);
  const to = from + offset;
  if (from === -1 || to < 0 || to >= board.columns.length) {
    return board;
  }
  const columns = [...board.columns];
  columns.splice(to, 0, ...columns.splice(from, 1));
  return { ...board, columns };
};

export const deleteCard = (board: BoardData, cardId: string): BoardData => ({
  ...board,
  cards: Object.fromEntries(Object.entries(board.cards).filter(([id]) => id !== cardId)),
  columns: board.columns.map((column) => ({
    ...column,
    cardIds: column.cardIds.filter((id) => id !== cardId),
  })),
});

export const createId = (prefix: string) => {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const timePart = Date.now().toString(36);
  return `${prefix}-${randomPart}${timePart}`;
};

// The backend's limits for labels.
export const MAX_LABELS = 10;
export const MAX_LABEL_LENGTH = 30;

// "a, b ,, a" -> ["a", "b"]: trimmed, no empty or repeated labels, within the backend's limits.
export const parseLabels = (text: string): string[] =>
  [
    ...new Set(
      text
        .split(",")
        .map((label) => label.trim().slice(0, MAX_LABEL_LENGTH).trim())
        .filter(Boolean)
    ),
  ].slice(0, MAX_LABELS);

// Every label used on the board, sorted.
export const boardLabels = (board: BoardData): string[] =>
  [...new Set(Object.values(board.cards).flatMap((card) => card.labels))].sort();

// Today as YYYY-MM-DD in the user's time zone, the format of `dueDate`.
export const localToday = (now = new Date()) =>
  `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

// ISO dates compare correctly as strings.
export const isOverdue = (card: Card, today: string) => Boolean(card.dueDate && card.dueDate < today);

export type Filters = { text: string; priority: Priority | ""; label: string };

export const noFilters: Filters = { text: "", priority: "", label: "" };

export const hasFilters = ({ text, priority, label }: Filters) => text.trim() !== "" || priority !== "" || label !== "";

// Text matches the title, details or a label, ignoring case.
export const matchesFilters = (card: Card, { text, priority, label }: Filters) => {
  const query = text.trim().toLowerCase();
  const matchesText =
    !query ||
    [card.title, card.details, ...card.labels].some((value) => value.toLowerCase().includes(query));
  return matchesText && (!priority || card.priority === priority) && (!label || card.labels.includes(label));
};
