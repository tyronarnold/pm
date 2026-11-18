import {
  addCard,
  deleteCard,
  editCard,
  initialData,
  moveCard,
  renameColumn,
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
    const card = { id: "card-new", title: "New", details: "" };
    const board = addCard(initialData, "col-discovery", card);
    expect(board.cards["card-new"]).toEqual(card);
    expect(board.columns[1].cardIds).toEqual(["card-3", "card-new"]);
  });

  it("editCard replaces the title and details", () => {
    const board = editCard(initialData, "card-1", "Edited", "New details");
    expect(board.cards["card-1"]).toEqual({ id: "card-1", title: "Edited", details: "New details" });
  });

  it("deleteCard removes the card and its place in the column", () => {
    const board = deleteCard(initialData, "card-4");
    expect(board.cards["card-4"]).toBeUndefined();
    expect(board.columns[2].cardIds).toEqual(["card-5"]);
  });
});
