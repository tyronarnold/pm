import {
  addCard,
  addColumn,
  boardLabels,
  columnColor,
  deleteCard,
  deleteColumn,
  editCard,
  hasFilters,
  initialData,
  isOverdue,
  localToday,
  matchesFilters,
  moveCard,
  moveColumn,
  noFilters,
  parseLabels,
  renameColumn,
  type Card,
  type Column,
} from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });

  it("moves a card to the end when dropped on its own column", () => {
    const result = moveCard(baseColumns, "card-1", "col-a");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
    expect(result[1]).toBe(baseColumns[1]);
  });

  it("changes nothing for a drop in place, unknown ids, or a column as the dragged item", () => {
    expect(moveCard(baseColumns, "card-1", "card-1")).toBe(baseColumns);
    expect(moveCard(baseColumns, "card-404", "col-b")).toBe(baseColumns);
    expect(moveCard(baseColumns, "card-1", "card-404")).toBe(baseColumns);
    expect(moveCard(baseColumns, "col-a", "card-3")).toBe(baseColumns);
    expect(moveCard(baseColumns, "col-a", "card-1")).toBe(baseColumns);
  });
});

describe("board updates", () => {
  // Every update must return a new board and leave the original untouched.
  const original = structuredClone(initialData);
  afterEach(() => expect(initialData).toEqual(original));

  it("renameColumn changes only that column's title", () => {
    const board = renameColumn(initialData, "col-review", "QA");
    expect(board.columns[3]).toEqual({ ...initialData.columns[3], title: "QA" });
    expect(board.columns.filter((column) => column.id !== "col-review")).toEqual(
      initialData.columns.filter((column) => column.id !== "col-review")
    );
  });

  it("addCard adds the card at the bottom of the column", () => {
    const card = { id: "card-new", title: "New", details: "", labels: [] };
    const board = addCard(initialData, "col-discovery", card);
    expect(board.cards["card-new"]).toEqual(card);
    expect(board.columns[1].cardIds).toEqual(["card-3", "card-new"]);
  });

  it("editCard replaces the card's fields and keeps its id", () => {
    const fields = { title: "Edited", details: "New details", priority: "high" as const, dueDate: "2026-12-01", labels: ["a"] };
    const board = editCard(initialData, "card-1", fields);
    expect(board.cards["card-1"]).toEqual({ ...fields, id: "card-1" });
    expect(board.cards["card-2"]).toBe(initialData.cards["card-2"]);
  });

  it("addColumn adds an empty column at the end", () => {
    const board = addColumn(initialData, { id: "col-new", title: "Ideas", cardIds: [] });
    expect(board.columns.map((column) => column.id)).toEqual([
      ...initialData.columns.map((column) => column.id),
      "col-new",
    ]);
    expect(board.cards).toBe(initialData.cards);
  });

  it("deleteColumn removes the column", () => {
    const board = deleteColumn(initialData, "col-review");
    expect(board.columns.map((column) => column.title)).toEqual(["Backlog", "Discovery", "In Progress", "Done"]);
  });

  it("moveColumn moves a column left or right, but not past either end", () => {
    const titles = (board: typeof initialData) => board.columns.map((column) => column.title);
    expect(titles(moveColumn(initialData, "col-review", -1))).toEqual([
      "Backlog", "Discovery", "Review", "In Progress", "Done",
    ]);
    expect(titles(moveColumn(initialData, "col-backlog", 1))).toEqual([
      "Discovery", "Backlog", "In Progress", "Review", "Done",
    ]);
    expect(moveColumn(initialData, "col-backlog", -1)).toBe(initialData);
    expect(moveColumn(initialData, "col-done", 1)).toBe(initialData);
    expect(moveColumn(initialData, "col-nope", 1)).toBe(initialData);
  });

  it("deleteCard removes the card and its place in the column", () => {
    const board = deleteCard(initialData, "card-4");
    expect(board.cards["card-4"]).toBeUndefined();
    expect(board.columns[2].cardIds).toEqual(["card-5"]);
  });
});

describe("labels", () => {
  it("parseLabels trims, drops empty and repeated labels", () => {
    expect(parseLabels(" design, ,api,design ,")).toEqual(["design", "api"]);
    expect(parseLabels("")).toEqual([]);
  });

  it("parseLabels keeps within the backend's limits", () => {
    expect(parseLabels(Array.from({ length: 12 }, (_, i) => `l${i}`).join(","))).toHaveLength(10);
    expect(parseLabels("x".repeat(40))).toEqual(["x".repeat(30)]);
  });

  it("boardLabels lists every label once, sorted", () => {
    const board = {
      ...initialData,
      cards: {
        ...initialData.cards,
        "card-1": { ...initialData.cards["card-1"], labels: ["ux", "api"] },
        "card-2": { ...initialData.cards["card-2"], labels: ["api"] },
      },
    };
    expect(boardLabels(board)).toEqual(["api", "ux"]);
    expect(boardLabels(initialData)).toEqual([]);
  });
});

describe("dates", () => {
  it("localToday formats the local date as YYYY-MM-DD", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });

  it("isOverdue is true only for due dates before today", () => {
    const card = (dueDate: string | null): Card => ({ ...initialData.cards["card-1"], dueDate });
    expect(isOverdue(card("2026-11-23"), "2026-11-24")).toBe(true);
    expect(isOverdue(card("2026-11-24"), "2026-11-24")).toBe(false);
    expect(isOverdue(card(null), "2026-11-24")).toBe(false);
  });
});

describe("filters", () => {
  const card: Card = {
    id: "card-x",
    title: "Write release notes",
    details: "For the December launch",
    priority: "high",
    dueDate: null,
    labels: ["docs"],
  };

  it("matches everything without filters", () => {
    expect(matchesFilters(card, noFilters)).toBe(true);
    expect(hasFilters(noFilters)).toBe(false);
    expect(hasFilters({ ...noFilters, text: "  " })).toBe(false);
  });

  it("matches text in the title, details or labels, ignoring case", () => {
    expect(matchesFilters(card, { ...noFilters, text: "RELEASE" })).toBe(true);
    expect(matchesFilters(card, { ...noFilters, text: "december" })).toBe(true);
    expect(matchesFilters(card, { ...noFilters, text: " docs " })).toBe(true);
    expect(matchesFilters(card, { ...noFilters, text: "budget" })).toBe(false);
  });

  it("matches priority and label exactly, combined with the text", () => {
    expect(matchesFilters(card, { ...noFilters, priority: "high" })).toBe(true);
    expect(matchesFilters(card, { ...noFilters, priority: "low" })).toBe(false);
    expect(matchesFilters(card, { ...noFilters, label: "docs" })).toBe(true);
    expect(matchesFilters(card, { ...noFilters, label: "doc" })).toBe(false);
    expect(matchesFilters(card, { text: "release", priority: "high", label: "ux" })).toBe(false);
    expect(hasFilters({ ...noFilters, label: "docs" })).toBe(true);
  });
});

describe("columnColor", () => {
  it("gives the standard columns their colors and repeats after five", () => {
    expect(columnColor(0)).toBe("var(--card-backlog)");
    expect(columnColor(4)).toBe("var(--card-done)");
    expect(columnColor(5)).toBe("var(--card-backlog)");
  });
});
