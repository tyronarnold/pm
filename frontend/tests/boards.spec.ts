import { expect, test, type Page } from "@playwright/test";
import { registerNewUser, saved } from "./helpers";

// Each test uses its own new account, so the boards it creates do not affect other tests.
test.beforeEach(async ({ page }) => {
  await registerNewUser(page);
});

const boardSelect = (page: Page) => page.getByRole("combobox", { name: "Board" });

const createBoard = async (page: Page, name: string) => {
  await page.getByRole("button", { name: "New board" }).click();
  await page.getByLabel("New board name").fill(name);
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(boardSelect(page).locator("option:checked")).toHaveText(name);
};

const addCard = async (page: Page, title: string) => {
  const backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: /add card/i }).click();
  await backlog.getByPlaceholder("Card title").fill(title);
  await saved(page, () => backlog.getByRole("button", { name: /add card/i }).click());
};

test("creates a board, keeps its cards separate, and stays on it after a reload", async ({ page }) => {
  await createBoard(page, "Launch plan");
  await expect(page.getByText("Align roadmap themes")).toHaveCount(0);
  await addCard(page, "Book the venue");

  await page.reload();
  await expect(boardSelect(page).locator("option:checked")).toHaveText("Launch plan");
  await expect(page.getByText("Book the venue")).toBeVisible();

  await boardSelect(page).selectOption({ label: "My first board" });
  await expect(page.getByText("Align roadmap themes")).toBeVisible();
  await expect(page.getByText("Book the venue")).toHaveCount(0);

  await boardSelect(page).selectOption({ label: "Launch plan" });
  await expect(page.getByText("Book the venue")).toBeVisible();
});

test("renames a board", async ({ page }) => {
  await page.getByRole("button", { name: "Rename board" }).click();
  await page.getByLabel("Board name").fill("Roadmap 2027");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(boardSelect(page).locator("option:checked")).toHaveText("Roadmap 2027");

  await page.reload();
  await expect(boardSelect(page).locator("option:checked")).toHaveText("Roadmap 2027");
});

test("deletes a board after confirming", async ({ page }) => {
  await createBoard(page, "Short lived");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete board" }).click();

  await expect(boardSelect(page).locator("option:checked")).toHaveText("My first board");
  await expect(boardSelect(page).locator("option")).toHaveCount(1);
  await page.reload();
  await expect(boardSelect(page).locator("option")).toHaveText(["My first board"]);
});

test("keeps the board when deleting is cancelled", async ({ page }) => {
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByText("Align roadmap themes")).toBeVisible();
  await page.reload();
  await expect(boardSelect(page).locator("option")).toHaveText(["My first board"]);
});

test("starts again from an empty workspace", async ({ page }) => {
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete board" }).click();
  await expect(page.getByText("You have no boards yet")).toBeVisible();

  await createBoard(page, "Fresh start");
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("the AI chat works on the open board", async ({ page }) => {
  await createBoard(page, "Chat board");
  // Answer as the backend does, so this test does not call the AI; only check the request.
  const chatUrl = page.waitForRequest((request) => request.url().includes("/chat"));
  await page.route("**/api/boards/*/chat", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ reply: "Nothing to change.", board: null, version: 1 }),
    })
  );
  const chat = page.getByRole("complementary", { name: "AI chat" });
  await chat.getByLabel("Message", { exact: true }).fill("Hello");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByText("Nothing to change.")).toBeVisible();
  expect((await chatUrl).url()).toContain(`/api/boards/${new URL(page.url()).searchParams.get("board")}/chat`);
});
