import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";
import { initialData } from "@/lib/kanban";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Serves the board for GET /api/board; everything else goes to the handler.
const mockFetch = (handler: (url: string, init?: RequestInit) => Response) => {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url === "/api/board" && !init ? jsonResponse(200, initialData) : handler(url, init)
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const signIn = async (username: string, password: string) => {
  await userEvent.type(await screen.findByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Home", () => {
  it("shows the login form when signed out", async () => {
    mockFetch(() => jsonResponse(401, {}));
    render(<Home />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Kanban Studio", level: 1 })).toBeInTheDocument();
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });

  it("shows the board when already signed in", async () => {
    mockFetch(() => jsonResponse(200, { username: "user" }));
    render(<Home />);
    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
  });

  it("renders the board returned by the API", async () => {
    const board = {
      columns: [
        { id: "col-backlog", title: "Saved backlog", cardIds: ["card-x"] },
        ...initialData.columns.slice(1).map((column) => ({ ...column, cardIds: [] })),
      ],
      cards: { "card-x": { id: "card-x", title: "Saved card", details: "From the server" } },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url === "/api/board" ? jsonResponse(200, board) : jsonResponse(200, { username: "user" })
      )
    );
    render(<Home />);

    expect(await screen.findByDisplayValue("Saved backlog")).toBeInTheDocument();
    expect(screen.getByText("Saved card")).toBeInTheDocument();
    expect(screen.queryByText("Align roadmap themes")).not.toBeInTheDocument();
  });

  it("signs in with valid credentials", async () => {
    const fetchMock = mockFetch((url) =>
      url === "/api/login"
        ? jsonResponse(200, { username: "user" })
        : jsonResponse(401, {})
    );
    render(<Home />);
    await signIn("user", "password");

    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
    const loginCall = fetchMock.mock.calls.find(([url]) => url === "/api/login");
    expect(JSON.parse(loginCall![1]!.body as string)).toEqual({
      username: "user",
      password: "password",
    });
  });

  it("shows an error for invalid credentials", async () => {
    mockFetch(() => jsonResponse(401, {}));
    render(<Home />);
    await signIn("user", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid username or password."
    );
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });

  it("logs out back to the login form", async () => {
    const fetchMock = mockFetch((url) =>
      url === "/api/me"
        ? jsonResponse(200, { username: "user" })
        : jsonResponse(200, { status: "ok" })
    );
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/logout", { method: "POST" });
  });
});
