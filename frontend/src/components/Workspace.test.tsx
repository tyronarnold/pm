import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Workspace } from "@/components/Workspace";
import { createFakeServer, emptyBoard, json } from "@/test/fakeServer";

const renderWorkspace = (onAccountDeleted = () => {}) =>
  render(<Workspace username="user" onLogout={() => {}} onAccountDeleted={onAccountDeleted} />);

const boardSelect = () => screen.getByRole("combobox", { name: "Board" });

const selectedName = () => (boardSelect() as HTMLSelectElement).selectedOptions[0].textContent;

const createBoard = async (name: string) => {
  await userEvent.click(screen.getByRole("button", { name: "New board" }));
  await userEvent.type(screen.getByLabelText("New board name"), name);
  await userEvent.click(screen.getByRole("button", { name: "Create board" }));
  await waitFor(() => expect(selectedName()).toBe(name));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("Workspace", () => {
  it("opens the first board and shows it in the URL", async () => {
    createFakeServer();
    renderWorkspace();
    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();
    expect(selectedName()).toBe("My first board");
    expect(window.location.search).toBe("?board=1");
  });

  it("creates a board and switches to it", async () => {
    const { state } = createFakeServer();
    renderWorkspace();
    await screen.findByText("Align roadmap themes");
    await createBoard("Launch plan");

    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/column-/)).toHaveLength(5);
    expect(window.location.search).toBe("?board=2");
    expect(state.boards.map((board) => board.name)).toEqual(["My first board", "Launch plan"]);
    expect(within(boardSelect()).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "My first board",
      "Launch plan",
    ]);
  });

  it("does not create a board without a name, and can cancel", async () => {
    const { state } = createFakeServer();
    renderWorkspace();
    await screen.findByText("Align roadmap themes");
    await userEvent.click(screen.getByRole("button", { name: "New board" }));
    await userEvent.type(screen.getByLabelText("New board name"), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(state.boards).toHaveLength(1);
    expect(selectedName()).toBe("My first board");
  });

  it("switches between boards", async () => {
    const { state } = createFakeServer();
    state.boards.push({ id: 5, name: "Second", version: 1, board: emptyBoard });
    renderWorkspace();
    await screen.findByText("Align roadmap themes");

    await userEvent.selectOptions(boardSelect(), "Second");
    await waitFor(() => expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument());
    expect(window.location.search).toBe("?board=5");

    await userEvent.selectOptions(boardSelect(), "My first board");
    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();
  });

  it("opens the board named in the URL", async () => {
    const { state } = createFakeServer();
    state.boards.push({ id: 5, name: "Second", version: 1, board: emptyBoard });
    window.history.replaceState(null, "", "/?board=5");
    renderWorkspace();
    await waitFor(() => expect(selectedName()).toBe("Second"));
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
  });

  it("opens the first board when the URL names a board that is not there", async () => {
    createFakeServer();
    window.history.replaceState(null, "", "/?board=99");
    renderWorkspace();
    expect(await screen.findByText("Align roadmap themes")).toBeInTheDocument();
    expect(window.location.search).toBe("?board=1");
  });

  it("saves changes to the open board", async () => {
    const { state } = createFakeServer();
    renderWorkspace();
    await screen.findByText("Align roadmap themes");
    await createBoard("Second");

    const backlog = screen.getByTestId("column-col-backlog");
    await userEvent.click(within(backlog).getByRole("button", { name: /add card/i }));
    await userEvent.type(within(backlog).getByPlaceholderText("Card title"), "On the second board");
    await userEvent.click(within(backlog).getByRole("button", { name: /add card/i }));

    await waitFor(() => expect(state.boards[1].version).toBe(2));
    expect(Object.values(state.boards[1].board.cards).map((card) => card.title)).toEqual([
      "On the second board",
    ]);
    expect(state.boards[0].version).toBe(1);
  });

  it("renames the open board", async () => {
    const { state } = createFakeServer();
    renderWorkspace();
    await screen.findByText("Align roadmap themes");
    await userEvent.click(screen.getByRole("button", { name: "Rename board" }));
    const input = screen.getByLabelText("Board name");
    expect(input).toHaveValue("My first board");
    await userEvent.clear(input);
    await userEvent.type(input, "Roadmap");
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));

    await waitFor(() => expect(selectedName()).toBe("Roadmap"));
    expect(state.boards[0].name).toBe("Roadmap");
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
  });

  it("deletes the open board after confirming and opens the next one", async () => {
    const { state } = createFakeServer();
    state.boards.push({ id: 5, name: "Second", version: 1, board: emptyBoard });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkspace();
    await screen.findByText("Align roadmap themes");

    await userEvent.click(screen.getByRole("button", { name: "Delete board" }));
    expect(confirm).toHaveBeenCalledWith('Delete the board "My first board" and all its cards?');
    await waitFor(() => expect(selectedName()).toBe("Second"));
    expect(state.boards.map((board) => board.id)).toEqual([5]);
    expect(window.location.search).toBe("?board=5");
  });

  it("keeps the board when deleting is not confirmed", async () => {
    const { state } = createFakeServer();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderWorkspace();
    await screen.findByText("Align roadmap themes");
    await userEvent.click(screen.getByRole("button", { name: "Delete board" }));
    expect(state.boards).toHaveLength(1);
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
  });

  it("shows an empty state after the last board is deleted, and can create a new one", async () => {
    createFakeServer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkspace();
    await screen.findByText("Align roadmap themes");
    await userEvent.click(screen.getByRole("button", { name: "Delete board" }));

    expect(await screen.findByText(/You have no boards yet/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Board" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rename board" })).not.toBeInTheDocument();
    expect(window.location.search).toBe("");

    await createBoard("Fresh start");
    expect(screen.getAllByTestId(/column-/)).toHaveLength(5);
  });

  it("shows a message when a board action fails and keeps the open board", async () => {
    const { fetchMock, handle } = createFakeServer();
    fetchMock.mockImplementation(async (url, init) =>
      url === "/api/boards" && init?.method === "POST" ? json({}, 500) : handle(url, init)
    );
    renderWorkspace();
    await screen.findByText("Align roadmap themes");
    await userEvent.click(screen.getByRole("button", { name: "New board" }));
    await userEvent.type(screen.getByLabelText("New board name"), "Will fail");
    await userEvent.click(screen.getByRole("button", { name: "Create board" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("That did not work.");
    expect(screen.getByText("Align roadmap themes")).toBeInTheDocument();
  });

  describe("account settings", () => {
    const openSettings = async () => {
      await userEvent.click(await screen.findByRole("button", { name: "Account" }));
      return screen.getByRole("region", { name: "Account settings" });
    };

    it("changes the password", async () => {
      const { state } = createFakeServer();
      renderWorkspace();
      const settings = await openSettings();
      await userEvent.type(within(settings).getByLabelText("Current password"), "password");
      await userEvent.type(within(settings).getByLabelText("New password"), "much-better");
      await userEvent.click(within(settings).getByRole("button", { name: "Change password" }));

      expect(await within(settings).findByRole("status")).toHaveTextContent("Your password has been changed.");
      expect(state.passwords.get("user")).toBe("much-better");
      expect(within(settings).getByLabelText("Current password")).toHaveValue("");
    });

    it("shows the error when the current password is wrong", async () => {
      const { state } = createFakeServer();
      renderWorkspace();
      const settings = await openSettings();
      await userEvent.type(within(settings).getByLabelText("Current password"), "wrong");
      await userEvent.type(within(settings).getByLabelText("New password"), "much-better");
      await userEvent.click(within(settings).getByRole("button", { name: "Change password" }));

      expect(await within(settings).findByRole("status")).toHaveTextContent("That password is not correct.");
      expect(state.passwords.get("user")).toBe("password");
    });

    it("does not delete the account with a wrong password", async () => {
      const { state } = createFakeServer();
      vi.spyOn(window, "confirm").mockReturnValue(true);
      const onDeleted = vi.fn();
      renderWorkspace(onDeleted);
      const settings = await openSettings();
      await userEvent.type(within(settings).getByLabelText("Password"), "wrong");
      await userEvent.click(within(settings).getByRole("button", { name: "Delete account" }));

      expect(await within(settings).findByRole("alert")).toHaveTextContent("That password is not correct.");
      expect(onDeleted).not.toHaveBeenCalled();
      expect(state.passwords.has("user")).toBe(true);
    });

    it("does not delete the account when not confirmed", async () => {
      const { fetchMock } = createFakeServer();
      vi.spyOn(window, "confirm").mockReturnValue(false);
      renderWorkspace();
      const settings = await openSettings();
      await userEvent.type(within(settings).getByLabelText("Password"), "password");
      await userEvent.click(within(settings).getByRole("button", { name: "Delete account" }));
      expect(fetchMock).not.toHaveBeenCalledWith("/api/me", expect.objectContaining({ method: "DELETE" }));
    });

    it("closes", async () => {
      createFakeServer();
      renderWorkspace();
      const settings = await openSettings();
      await userEvent.click(within(settings).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("region", { name: "Account settings" })).not.toBeInTheDocument();
    });
  });
});
