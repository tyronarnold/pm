import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard } from "@/components/KanbanBoard";
import { initialData, type BoardData } from "@/lib/kanban";

const getFirstColumn = () => screen.getAllByTestId(/column-/i)[0];

let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const puts = (): { version: number; board: BoardData }[] =>
  fetchMock.mock.calls
    .filter(([url, init]) => url === "/api/boards/1" && init?.method === "PUT")
    .map(([, init]) => JSON.parse(init.body));

const savedBoards = () => puts().map((put) => put.board);

const lastSaved = () => savedBoards().at(-1)!;

const renderBoard = () =>
  render(<KanbanBoard boardId={1} initialBoard={initialData} initialVersion={1} />);

// Behaves like the backend: a save based on version n is stored as version n + 1.
const fakeServer = async (url: string, init?: RequestInit) => {
  if (url === "/api/boards/1" && init?.method === "PUT") {
    const body = JSON.parse(init.body as string);
    return json({ version: body.version + 1, board: body.board });
  }
  return json({});
};

beforeEach(() => {
  fetchMock = vi.fn(fakeServer);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("KanbanBoard", () => {
  it("renders the board it is given", () => {
    renderBoard();
    expect(screen.getAllByTestId(/column-/i)).toHaveLength(5);
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves a column rename on blur, not on every keystroke", async () => {
    renderBoard();
    const input = within(getFirstColumn()).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "New Name");
    expect(input).toHaveValue("New Name");
    expect(savedBoards()).toHaveLength(0);

    await userEvent.tab();
    await waitFor(() => expect(savedBoards()).toHaveLength(1));
    expect(lastSaved().columns[0].title).toBe("New Name");
  });

  it("saves a column rename on Enter", async () => {
    renderBoard();
    const input = within(getFirstColumn()).getByLabelText("Column title");
    await userEvent.clear(input);
    await userEvent.type(input, "Ideas{Enter}");
    await waitFor(() => expect(savedBoards()).toHaveLength(1));
    expect(lastSaved().columns[0].title).toBe("Ideas");
  });

  it("adds and removes a card, saving each change", async () => {
    renderBoard();
    const column = getFirstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    await userEvent.type(within(column).getByPlaceholderText(/card title/i), "New card");
    await userEvent.type(within(column).getByPlaceholderText(/details/i), "Notes");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

    expect(within(column).getByText("New card")).toBeInTheDocument();
    const added = lastSaved();
    const newId = added.columns[0].cardIds.at(-1)!;
    expect(added.cards[newId]).toEqual({
      id: newId,
      title: "New card",
      details: "Notes",
      priority: null,
      dueDate: null,
      labels: [],
    });

    await userEvent.click(within(column).getByRole("button", { name: /delete new card/i }));

    expect(within(column).queryByText("New card")).not.toBeInTheDocument();
    expect(lastSaved()).toEqual(initialData);
    expect(savedBoards()).toHaveLength(2);
  });

  it("edits a card and saves it", async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    const titleInput = screen.getByLabelText("Card title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Updated title");
    const detailsInput = screen.getByLabelText("Card details");
    await userEvent.clear(detailsInput);
    await userEvent.type(detailsInput, "Updated details");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByText("Updated title")).toBeInTheDocument();
    expect(screen.getByText("Updated details")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    expect(lastSaved().cards["card-1"]).toEqual({
      ...initialData.cards["card-1"],
      title: "Updated title",
      details: "Updated details",
    });
  });

  it("cancels editing without changes or saving", async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    const titleInput = screen.getByLabelText("Card title");
    await userEvent.clear(titleInput);
    await userEvent.type(titleInput, "Discarded");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
    expect(screen.queryByText("Discarded")).not.toBeInTheDocument();
    expect(savedBoards()).toHaveLength(0);
  });

  it("does not save an empty title", async () => {
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
    await userEvent.clear(screen.getByLabelText("Card title"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(screen.getByLabelText("Card title")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
    expect(savedBoards()).toHaveLength(0);
  });

  it("shows an error when a save fails and clears it after a good save", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 500 }));
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Delete Align roadmap themes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your changes.");

    await userEvent.click(screen.getByRole("button", { name: "Delete Gather customer signals" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows the board returned by the AI chat without saving it again", async () => {
    const aiBoard: BoardData = {
      ...initialData,
      columns: initialData.columns.map((column) =>
        column.id === "col-done" ? { ...column, cardIds: [...column.cardIds, "card-ai"] } : column
      ),
      cards: { ...initialData.cards, "card-ai": { id: "card-ai", title: "From the AI", details: "", labels: [] } },
    };
    fetchMock.mockResolvedValueOnce(json({ reply: "Added it.", board: aiBoard, version: 7 }));
    renderBoard();
    await userEvent.type(screen.getByLabelText("Message"), "Add a card to Done");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    const done = await screen.findByTestId("column-col-done");
    expect(await within(done).findByText("From the AI")).toBeInTheDocument();
    expect(savedBoards()).toHaveLength(0);

    // The next save is based on the version the chat returned.
    await userEvent.click(screen.getByRole("button", { name: "Delete From the AI" }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0].version).toBe(7);
  });

  it("sends saves one at a time, each based on the version the last save returned", async () => {
    let finishFirstSave: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (finishFirstSave = resolve)));
    renderBoard();

    await userEvent.click(screen.getByRole("button", { name: "Delete Align roadmap themes" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Gather customer signals" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete QA micro-interactions" }));
    expect(puts()).toHaveLength(1);
    expect(puts()[0].version).toBe(1);

    finishFirstSave(json({ version: 2, board: puts()[0].board }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].version).toBe(2);
    expect(Object.keys(puts()[1].board.cards)).not.toContain("card-6");
    expect(Object.keys(puts()[1].board.cards)).not.toContain("card-2");
  });

  it("loads the latest board when a save conflicts", async () => {
    const serverBoard: BoardData = {
      ...initialData,
      cards: {
        ...initialData.cards,
        "card-1": { id: "card-1", title: "Changed in another tab", details: "", labels: [] },
      },
    };
    fetchMock.mockResolvedValueOnce(json({ detail: "conflict", version: 5, board: serverBoard }, 409));
    renderBoard();

    await userEvent.click(screen.getByRole("button", { name: "Delete Gather customer signals" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed somewhere else");
    expect(screen.getByText("Changed in another tab")).toBeInTheDocument();
    expect(screen.getByText("Gather customer signals")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete Gather customer signals" }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1].version).toBe(5);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });

  it("shows an error when the server cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Delete Align roadmap themes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save your changes.");
  });

  describe("priority, due date and labels", () => {
    const detailedBoard: BoardData = {
      ...initialData,
      cards: {
        ...initialData.cards,
        "card-1": { ...initialData.cards["card-1"], priority: "high", dueDate: "2020-01-01", labels: ["planning"] },
        "card-2": { ...initialData.cards["card-2"], priority: "low", dueDate: "2099-03-15", labels: ["research", "ux"] },
        "card-7": { ...initialData.cards["card-7"], dueDate: "2020-01-01" },
      },
    };

    const renderDetailed = () =>
      render(<KanbanBoard boardId={1} initialBoard={detailedBoard} initialVersion={1} />);

    const visibleTitles = () => screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);

    it("shows priority, due date and labels on the card", () => {
      renderDetailed();
      const card = screen.getByTestId("card-card-2");
      expect(within(card).getByText("low priority")).toBeInTheDocument();
      expect(within(card).getByText("Due Mar 15, 2099")).toBeInTheDocument();
      expect(within(card).getByText("research")).toBeInTheDocument();
      expect(within(card).getByText("ux")).toBeInTheDocument();
    });

    it("marks past due dates as overdue, except in the last column", () => {
      renderDetailed();
      expect(within(screen.getByTestId("card-card-1")).getByText("Overdue Jan 1, 2020")).toBeInTheDocument();
      expect(within(screen.getByTestId("card-card-7")).getByText("Due Jan 1, 2020")).toBeInTheDocument();
    });

    it("adds a card with every field", async () => {
      renderBoard();
      const column = getFirstColumn();
      await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
      await userEvent.type(within(column).getByLabelText("Card title"), "Launch");
      await userEvent.selectOptions(within(column).getByLabelText("Priority"), "medium");
      fireEvent.change(within(column).getByLabelText("Due date"), { target: { value: "2026-12-01" } });
      await userEvent.type(within(column).getByLabelText("Labels"), "launch, marketing, launch");
      await userEvent.click(within(column).getByRole("button", { name: /add card/i }));

      const saved = lastSaved();
      const newId = saved.columns[0].cardIds.at(-1)!;
      expect(saved.cards[newId]).toEqual({
        id: newId,
        title: "Launch",
        details: "",
        priority: "medium",
        dueDate: "2026-12-01",
        labels: ["launch", "marketing"],
      });
      expect(within(column).getByText("medium priority")).toBeInTheDocument();
    });

    it("edits and clears the fields", async () => {
      renderDetailed();
      await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
      expect(screen.getByLabelText("Priority")).toHaveValue("high");
      expect(screen.getByLabelText("Due date")).toHaveValue("2020-01-01");
      expect(screen.getByLabelText("Labels")).toHaveValue("planning");

      await userEvent.selectOptions(screen.getByLabelText("Priority"), "");
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "" } });
      await userEvent.clear(screen.getByLabelText("Labels"));
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(lastSaved().cards["card-1"]).toEqual({
        ...initialData.cards["card-1"],
        priority: null,
        dueDate: null,
        labels: [],
      });
      expect(within(screen.getByTestId("card-card-1")).queryByText(/priority|Overdue/)).not.toBeInTheDocument();
    });

    it("searches titles, details and labels", async () => {
      renderDetailed();
      await userEvent.type(screen.getByLabelText("Search cards"), "ux");
      expect(visibleTitles()).toEqual(["Gather customer signals"]);

      await userEvent.clear(screen.getByLabelText("Search cards"));
      await userEvent.type(screen.getByLabelText("Search cards"), "MARKETING");
      expect(visibleTitles()).toEqual(["Ship marketing page"]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("filters by priority and label, shows counts, and clears", async () => {
      renderDetailed();
      expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText("Filter by priority"), "high");
      expect(visibleTitles()).toEqual(["Align roadmap themes"]);
      const backlog = screen.getByTestId("column-col-backlog");
      expect(within(backlog).getByLabelText("1 of 2 cards")).toHaveTextContent("1/2");
      expect(within(screen.getByTestId("column-col-review")).getByText("No matching cards")).toBeInTheDocument();

      await userEvent.selectOptions(screen.getByLabelText("Filter by priority"), "");
      await userEvent.selectOptions(screen.getByLabelText("Filter by label"), "research");
      expect(visibleTitles()).toEqual(["Gather customer signals"]);

      await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
      expect(visibleTitles()).toHaveLength(8);
      expect(within(backlog).getByLabelText("2 cards")).toHaveTextContent("2");
    });

    it("only offers a label filter when the board has labels", () => {
      renderBoard();
      expect(screen.queryByLabelText("Filter by label")).not.toBeInTheDocument();
      expect(within(screen.getByTestId("column-col-review")).queryByText("No matching cards")).not.toBeInTheDocument();
    });
  });
});
