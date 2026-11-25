import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KanbanBoard, POLL_INTERVAL_MS } from "@/components/KanbanBoard";
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
  render(<KanbanBoard boardId={1} initialBoard={initialData} initialVersion={1} people={["user"]} username="user" />);

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
      assignee: null,
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
      render(<KanbanBoard boardId={1} initialBoard={detailedBoard} initialVersion={1} people={["user"]} username="user" />);

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
        assignee: null,
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

  describe("columns", () => {
    const columnTitles = () =>
      screen.getAllByLabelText("Column title").map((input) => (input as HTMLInputElement).value);

    it("adds a column at the end and saves it", async () => {
      renderBoard();
      await userEvent.click(screen.getByRole("button", { name: "Add column" }));
      await userEvent.type(screen.getByLabelText("New column title"), "  Blocked ");
      await userEvent.click(screen.getByRole("button", { name: "Add column" }));

      expect(columnTitles()).toEqual(["Backlog", "Discovery", "In Progress", "Review", "Done", "Blocked"]);
      const added = lastSaved().columns.at(-1)!;
      expect(added.title).toBe("Blocked");
      expect(added.cardIds).toEqual([]);
      expect(added.id).toMatch(/^col-/);
      expect(screen.getByRole("list", { name: "Columns" })).toHaveTextContent("Blocked");
    });

    it("does not add a column without a title, and can cancel", async () => {
      renderBoard();
      await userEvent.click(screen.getByRole("button", { name: "Add column" }));
      await userEvent.type(screen.getByLabelText("New column title"), "   ");
      await userEvent.click(screen.getByRole("button", { name: "Add column" }));
      await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(columnTitles()).toHaveLength(5);
      expect(savedBoards()).toHaveLength(0);
    });

    it("adds cards to a new column", async () => {
      renderBoard();
      await userEvent.click(screen.getByRole("button", { name: "Add column" }));
      await userEvent.type(screen.getByLabelText("New column title"), "Blocked");
      await userEvent.click(screen.getByRole("button", { name: "Add column" }));

      const blocked = screen.getAllByTestId(/^column-/).at(-1)!;
      await userEvent.click(within(blocked).getByRole("button", { name: /add card/i }));
      await userEvent.type(within(blocked).getByLabelText("Card title"), "Waiting on legal");
      await userEvent.click(within(blocked).getByRole("button", { name: /add card/i }));

      const saved = lastSaved();
      const cardId = saved.columns.at(-1)!.cardIds[0];
      expect(saved.cards[cardId].title).toBe("Waiting on legal");
      // The sixth column repeats the first column's card color.
      expect(within(blocked).getByTestId(`card-${cardId}`).style.backgroundColor).toBe("var(--card-backlog)");
    });

    it("moves columns left and right, and not past either end", async () => {
      renderBoard();
      expect(screen.getByRole("button", { name: "Move Backlog column left" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Move Done column right" })).toBeDisabled();

      await userEvent.click(screen.getByRole("button", { name: "Move Review column left" }));
      expect(columnTitles()).toEqual(["Backlog", "Discovery", "Review", "In Progress", "Done"]);
      await userEvent.click(screen.getByRole("button", { name: "Move Backlog column right" }));
      expect(columnTitles()).toEqual(["Discovery", "Backlog", "Review", "In Progress", "Done"]);
      await waitFor(() => expect(savedBoards()).toHaveLength(2));
      expect(lastSaved().columns.map((column) => column.id)).toEqual([
        "col-discovery", "col-backlog", "col-review", "col-progress", "col-done",
      ]);
    });

    it("colors cards by the column's position", async () => {
      renderBoard();
      await userEvent.click(screen.getByRole("button", { name: "Move Review column left" }));
      expect(screen.getByTestId("card-card-6").style.backgroundColor).toBe("var(--card-progress)");
    });

    it("only deletes empty columns", async () => {
      renderBoard();
      const remove = screen.getByRole("button", { name: "Delete Review column" });
      expect(remove).toBeDisabled();
      expect(remove).toHaveAttribute("title", "Move or delete its cards first");

      await userEvent.click(screen.getByRole("button", { name: "Delete QA micro-interactions" }));
      expect(remove).toBeEnabled();
      await userEvent.click(remove);
      expect(columnTitles()).toEqual(["Backlog", "Discovery", "In Progress", "Done"]);
      await waitFor(() => expect(lastSaved().columns).toHaveLength(4));
    });

    it("treats the last column as finished after reordering", async () => {
      const board: BoardData = {
        ...initialData,
        cards: {
          ...initialData.cards,
          "card-7": { ...initialData.cards["card-7"], dueDate: "2020-01-01" },
        },
      };
      render(<KanbanBoard boardId={1} initialBoard={board} initialVersion={1} people={["user"]} username="user" />);
      expect(within(screen.getByTestId("card-card-7")).getByText("Due Jan 1, 2020")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Move Done column left" }));
      expect(within(screen.getByTestId("card-card-7")).getByText("Overdue Jan 1, 2020")).toBeInTheDocument();
    });

    it("names untitled columns in the control labels", () => {
      const board: BoardData = { ...initialData, columns: [{ id: "col-x", title: "", cardIds: [] }], cards: {} };
      render(<KanbanBoard boardId={1} initialBoard={board} initialVersion={1} people={["user"]} username="user" />);
      expect(screen.getByRole("button", { name: "Delete untitled column" })).toBeEnabled();
    });
  });

  it("drops an unsaved change when the AI returns a board, and says so", async () => {
    let finishSave: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (finishSave = resolve)));
    fetchMock.mockResolvedValueOnce(json({ reply: "Done.", board: initialData, version: 9 }));
    renderBoard();

    // The first delete is being saved; the second waits for it, then the AI's board arrives.
    await userEvent.click(screen.getByRole("button", { name: "Delete Align roadmap themes" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete Gather customer signals" }));
    await userEvent.type(screen.getByLabelText("Message"), "Tidy up");
    await userEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/changed somewhere else/)).toBeInTheDocument();
    expect(screen.getByText("Gather customer signals")).toBeInTheDocument();
    finishSave(json({ version: 2, board: puts()[0].board }));
    await waitFor(() => expect(puts()).toHaveLength(1)); // the dropped change is not sent
  });

  it("does not add a card whose title is only spaces, and can cancel", async () => {
    renderBoard();
    const column = getFirstColumn();
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    await userEvent.type(within(column).getByLabelText("Card title"), "   ");
    await userEvent.click(within(column).getByRole("button", { name: /add card/i }));
    expect(within(column).getByLabelText("Card title")).toBeInTheDocument();

    await userEvent.click(within(column).getByRole("button", { name: "Cancel" }));
    expect(within(column).queryByLabelText("Card title")).not.toBeInTheDocument();
    expect(savedBoards()).toHaveLength(0);
  });

  describe("assignees", () => {
    const renderWithPeople = (board: BoardData = initialData) =>
      render(
        <KanbanBoard boardId={1} initialBoard={board} initialVersion={1} people={["user", "alice"]} username="user" />
      );

    it("assigns a card to someone on the board", async () => {
      renderWithPeople();
      await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
      expect(within(screen.getByLabelText("Assignee")).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Unassigned",
        "user",
        "alice",
      ]);
      await userEvent.selectOptions(screen.getByLabelText("Assignee"), "alice");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));

      expect(lastSaved().cards["card-1"].assignee).toBe("alice");
      expect(within(screen.getByTestId("card-card-1")).getByLabelText("Assigned to alice")).toHaveTextContent("alice");
    });

    it("keeps a former member selectable on their card", async () => {
      renderWithPeople({
        ...initialData,
        cards: { ...initialData.cards, "card-1": { ...initialData.cards["card-1"], assignee: "zoe" } },
      });
      await userEvent.click(screen.getByRole("button", { name: "Edit Align roadmap themes" }));
      expect(screen.getByLabelText("Assignee")).toHaveValue("zoe");
      await userEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(lastSaved().cards["card-1"].assignee).toBe("zoe");
    });

    it("filters by assignee, including me and unassigned", async () => {
      renderWithPeople({
        ...initialData,
        cards: {
          ...initialData.cards,
          "card-1": { ...initialData.cards["card-1"], assignee: "alice" },
          "card-2": { ...initialData.cards["card-2"], assignee: "user" },
        },
      });
      const filter = screen.getByLabelText("Filter by assignee");
      expect(within(filter).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Anyone",
        "user (me)",
        "alice",
        "Unassigned",
      ]);
      const titles = () => screen.getAllByRole("heading", { level: 4 }).map((h) => h.textContent);

      await userEvent.selectOptions(filter, "user (me)");
      expect(titles()).toEqual(["Gather customer signals"]);
      await userEvent.selectOptions(filter, "alice");
      expect(titles()).toEqual(["Align roadmap themes"]);
      await userEvent.selectOptions(filter, "Unassigned");
      expect(titles()).toHaveLength(6);
    });
  });

  describe("live updates", () => {
    // What GET /api/boards/1 returns: the board as saved by someone else.
    let latest: { version: number; board: BoardData };

    const changedElsewhere = (version: number): { version: number; board: BoardData } => ({
      version,
      board: {
        ...initialData,
        cards: { ...initialData.cards, "card-1": { ...initialData.cards["card-1"], title: "Changed elsewhere" } },
      },
    });

    const gets = () => fetchMock.mock.calls.filter(([url, init]) => url === "/api/boards/1" && !init);

    const tick = () => act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS));

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      latest = { version: 1, board: initialData };
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
        url === "/api/boards/1" && !init ? json({ id: 1, name: "Board", owner: "user", members: [], ...latest }) : fakeServer(url, init)
      );
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("shows a newer version from the server, and bases the next save on it", async () => {
      renderBoard();
      latest = changedElsewhere(4);
      await tick();
      expect(screen.getByText("Changed elsewhere")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Delete Gather customer signals" }));
      await waitFor(() => expect(puts()).toHaveLength(1));
      expect(puts()[0].version).toBe(4);
      expect(puts()[0].board.cards["card-1"].title).toBe("Changed elsewhere");
    });

    it("ignores the server's board when it is not newer", async () => {
      renderBoard();
      latest = { ...changedElsewhere(1) };
      await tick();
      expect(gets()).toHaveLength(1);
      expect(screen.queryByText("Changed elsewhere")).not.toBeInTheDocument();
    });

    it("does not check while a change is being saved", async () => {
      fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {})); // the save never finishes
      renderBoard();
      await userEvent.click(screen.getByRole("button", { name: "Delete Align roadmap themes" }));
      latest = changedElsewhere(2);
      await tick();
      expect(gets()).toHaveLength(0);
      expect(screen.queryByText("Changed elsewhere")).not.toBeInTheDocument();
    });

    it("does not overwrite a column title being typed", async () => {
      renderBoard();
      const title = within(getFirstColumn()).getByLabelText("Column title");
      await userEvent.clear(title);
      await userEvent.type(title, "Half typ");
      latest = changedElsewhere(2);
      await tick();
      expect(gets()).toHaveLength(0);
      expect(title).toHaveValue("Half typ");

      await userEvent.tab(); // saving the title ends the pause
      await waitFor(() => expect(puts()).toHaveLength(1));
    });

    it("does not check while the tab is hidden", async () => {
      const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      renderBoard();
      latest = changedElsewhere(2);
      await tick();
      expect(gets()).toHaveLength(0);

      hidden.mockReturnValue(false);
      await tick();
      expect(screen.getByText("Changed elsewhere")).toBeInTheDocument();
    });

    it("tries again after a failed check", async () => {
      renderBoard();
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await tick();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();

      latest = changedElsewhere(2);
      await tick();
      expect(screen.getByText("Changed elsewhere")).toBeInTheDocument();
    });

    it("stops checking when the board is closed", async () => {
      const { unmount } = renderBoard();
      await tick();
      unmount();
      await tick();
      expect(gets()).toHaveLength(1);
    });
  });
});
