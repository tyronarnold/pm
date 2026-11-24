import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Home from "@/app/page";
import { createFakeServer, json } from "@/test/fakeServer";

const fillIn = async (username: string, password: string) => {
  await userEvent.type(await screen.findByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
};

const signIn = async (username: string, password: string) => {
  await fillIn(username, password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
};

const register = async (username: string, password: string) => {
  await userEvent.click(await screen.findByRole("button", { name: "Create an account" }));
  await fillIn(username, password);
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("Home", () => {
  it("shows the login form when signed out", async () => {
    createFakeServer({ signedIn: false });
    render(<Home />);
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Kanban Studio", level: 1 })).toBeInTheDocument();
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });

  it("shows the board when already signed in", async () => {
    createFakeServer();
    render(<Home />);
    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
    expect(screen.getByText("Signed in as")).toHaveTextContent("Signed in as user");
  });

  it("signs in with valid credentials", async () => {
    const { fetchMock } = createFakeServer({ signedIn: false });
    render(<Home />);
    await signIn("user", "password");

    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
    const loginCall = fetchMock.mock.calls.find(([url]) => url === "/api/login");
    expect(JSON.parse(loginCall![1]!.body as string)).toEqual({ username: "user", password: "password" });
  });

  it("shows an error for invalid credentials", async () => {
    createFakeServer({ signedIn: false });
    render(<Home />);
    await signIn("user", "wrong");

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid username or password.");
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });

  it("shows the server's message when sign-in is locked", async () => {
    const { fetchMock, handle } = createFakeServer({ signedIn: false });
    const locked = "Too many failed sign-in attempts. Please wait 15 minutes and try again.";
    fetchMock.mockImplementation(async (url, init) =>
      url === "/api/login" ? json({ detail: locked }, 429) : handle(url, init)
    );
    render(<Home />);
    await signIn("user", "password");

    expect(await screen.findByRole("alert")).toHaveTextContent(locked);
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);
  });

  it("creates an account and opens its board", async () => {
    const { fetchMock } = createFakeServer({ signedIn: false });
    render(<Home />);
    await register("alice", "alice-password");

    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
    expect(screen.getByText("Signed in as")).toHaveTextContent("Signed in as alice");
    const call = fetchMock.mock.calls.find(([url]) => url === "/api/register");
    expect(JSON.parse(call![1]!.body as string)).toEqual({ username: "alice", password: "alice-password" });
  });

  it("shows why an account could not be created", async () => {
    createFakeServer({ signedIn: false });
    render(<Home />);
    expect(screen.queryByText(/Passwords need at least 8 characters/)).not.toBeInTheDocument();
    await register("user", "whatever-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("That username is already taken.");
  });

  it("explains the rules when the server rejects the username or password", async () => {
    const { fetchMock, handle } = createFakeServer({ signedIn: false });
    fetchMock.mockImplementation(async (url, init) =>
      url === "/api/register" ? json({ detail: [{ msg: "String should match pattern" }] }, 422) : handle(url, init)
    );
    render(<Home />);
    await register("Bad Name", "short");
    expect(await screen.findByRole("alert")).toHaveTextContent("Usernames are 3-32 lowercase letters");
  });

  it("switches back from creating an account to signing in", async () => {
    createFakeServer({ signedIn: false });
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "Create an account" }));
    expect(screen.getByText("Create an account to start planning.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText("Sign in to see your boards.")).toBeInTheDocument();
  });

  it("shows an error with a retry when the boards cannot be loaded", async () => {
    const { fetchMock, handle } = createFakeServer();
    let available = false;
    fetchMock.mockImplementation(async (url, init) =>
      url === "/api/boards" && !available ? json({}, 500) : handle(url, init)
    );
    render(<Home />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load your board.");
    expect(screen.queryAllByTestId(/column-/)).toHaveLength(0);

    available = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
  });

  it("shows an error with a retry when the server cannot be reached at all", async () => {
    const { fetchMock, handle } = createFakeServer();
    let reachable = false;
    fetchMock.mockImplementation(async (url, init) =>
      reachable ? handle(url, init) : Promise.reject(new TypeError("Failed to fetch"))
    );
    render(<Home />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not reach the server.");

    reachable = true;
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findAllByTestId(/column-/)).toHaveLength(5);
  });

  it("logs out back to the login form", async () => {
    const { fetchMock } = createFakeServer();
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/logout", { method: "POST" });
  });

  it("returns to the login form after deleting the account", async () => {
    const { state } = createFakeServer();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Home />);
    await userEvent.click(await screen.findByRole("button", { name: "Account" }));
    const settings = screen.getByRole("region", { name: "Account settings" });
    await userEvent.type(within(settings).getByLabelText("Password"), "password");
    await userEvent.click(screen.getByRole("button", { name: "Delete account" }));

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(state.passwords.has("user")).toBe(false);
  });
});
