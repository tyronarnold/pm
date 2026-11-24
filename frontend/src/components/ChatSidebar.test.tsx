import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatSidebar } from "@/components/ChatSidebar";
import { initialData } from "@/lib/kanban";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

const chatBodies = () =>
  fetchMock.mock.calls
    .filter(([url]) => url === "/api/boards/1/chat")
    .map(([, init]) => JSON.parse(init.body));

const send = async (text: string) => {
  await userEvent.type(screen.getByLabelText("Message"), text);
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
};

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse(200, { reply: "Sure thing.", board: initialData, version: 2 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ChatSidebar", () => {
  it("shows the sent message and the reply", async () => {
    render(<ChatSidebar boardId={1} onBoardUpdate={() => {}} />);
    await send("Hello there");

    const log = screen.getByRole("log");
    expect(await within(log).findByText("Sure thing.")).toBeInTheDocument();
    expect(within(log).getByText("Hello there")).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toHaveValue("");
    expect(chatBodies()).toEqual([{ message: "Hello there", history: [] }]);
  });

  it("sends the conversation so far as history", async () => {
    render(<ChatSidebar boardId={1} onBoardUpdate={() => {}} />);
    await send("First");
    await screen.findByText("Sure thing.");
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { reply: "Second reply", board: null, version: 2 }));
    await send("Second");
    await screen.findByText("Second reply");

    expect(chatBodies()[1]).toEqual({
      message: "Second",
      history: [
        { role: "user", content: "First" },
        { role: "assistant", content: "Sure thing." },
      ],
    });
  });

  it("passes the returned board to onBoardUpdate", async () => {
    const onBoardUpdate = vi.fn();
    render(<ChatSidebar boardId={1} onBoardUpdate={onBoardUpdate} />);
    await send("Do something");
    await screen.findByText("Sure thing.");
    expect(onBoardUpdate).toHaveBeenCalledWith(initialData, 2);
  });

  it("does not replace the board when the AI made no changes", async () => {
    const onBoardUpdate = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { reply: "You have 8 cards.", board: null, version: 1 }));
    render(<ChatSidebar boardId={1} onBoardUpdate={onBoardUpdate} />);
    await send("How many cards?");
    await screen.findByText("You have 8 cards.");
    expect(onBoardUpdate).not.toHaveBeenCalled();
  });

  it("shows a loading indicator while waiting", async () => {
    let respond: (response: Response) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (respond = resolve)));
    render(<ChatSidebar boardId={1} onBoardUpdate={() => {}} />);
    await send("Slow question");

    expect(screen.getByRole("status")).toHaveTextContent("Thinking...");
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();

    respond(jsonResponse(200, { reply: "Done waiting.", board: null, version: 1 }));
    expect(await screen.findByText("Done waiting.")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows an error when the request fails", async () => {
    const onBoardUpdate = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse(500, {}));
    render(<ChatSidebar boardId={1} onBoardUpdate={onBoardUpdate} />);
    await send("Break please");

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be reached");
    expect(onBoardUpdate).not.toHaveBeenCalled();

    await send("Try again");
    await screen.findByText("Sure thing.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's message when the AI call fails", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, { detail: "The AI took too long to reply. Please try again." })
    );
    render(<ChatSidebar boardId={1} onBoardUpdate={() => {}} />);
    await send("Hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The AI took too long to reply. Please try again."
    );
  });

  it("shows a friendly message when the server cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<ChatSidebar boardId={1} onBoardUpdate={() => {}} />);
    await send("Hello");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The assistant could not be reached. Please try again."
    );
  });

  it("can be hidden and shown again, keeping the conversation", async () => {
    render(<ChatSidebar boardId={1} onBoardUpdate={() => {}} />);
    await send("Remember me");
    await screen.findByText("Sure thing.");

    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByLabelText("Message")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show AI chat" }));
    expect(screen.getByText("Remember me")).toBeInTheDocument();
  });
});
