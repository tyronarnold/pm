import { expect, test, type Page } from "@playwright/test";
import { resetBoard, saved, signIn } from "./helpers";

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await resetBoard(page);
  await page.reload();
});

const dragCard = async (page: Page, cardTestId: string, columnTestId: string) => {
  const card = page.getByTestId(cardTestId);
  const targetColumn = page.getByTestId(columnTestId);
  const cardBox = await card.boundingBox();
  const columnBox = await targetColumn.boundingBox();
  if (!cardBox || !columnBox) {
    throw new Error("Unable to resolve drag coordinates.");
  }
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(columnBox.x + columnBox.width / 2, columnBox.y + 120, {
    steps: 12,
  });
  await page.mouse.up();
};

test("loads the kanban board", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "Kanban Studio" })).toBeVisible();
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
});

test("adds a card to a column", async ({ page }) => {
  const firstColumn = page.locator('[data-testid^="column-"]').first();
  await firstColumn.getByRole("button", { name: /add card/i }).click();
  await firstColumn.getByPlaceholder("Card title").fill("Playwright card");
  await firstColumn.getByPlaceholder("Details").fill("Added via e2e.");
  await saved(page, () => firstColumn.getByRole("button", { name: /add card/i }).click());
  await expect(firstColumn.getByText("Playwright card")).toBeVisible();
});

test("moves a card between columns", async ({ page }) => {
  await saved(page, () => dragCard(page, "card-card-1", "column-col-review"));
  await expect(page.getByTestId("column-col-review").getByTestId("card-card-1")).toBeVisible();
});

test("edits a card", async ({ page }) => {
  const card = page.getByTestId("card-card-1");
  await card.getByRole("button", { name: "Edit Align roadmap themes", exact: true }).click();
  await card.getByLabel("Card title").fill("Edited in e2e");
  await card.getByLabel("Card details").fill("New details.");
  await saved(page, () => card.getByRole("button", { name: "Save" }).click());
  await expect(card.getByText("Edited in e2e")).toBeVisible();
  await expect(card.getByText("New details.")).toBeVisible();
});

test("renames a column", async ({ page }) => {
  const title = page.getByTestId("column-col-backlog").getByLabel("Column title");
  await title.fill("Ideas");
  await saved(page, () => title.press("Enter"));
  await expect(title).toHaveValue("Ideas");
  await expect(page.locator("header").getByText("Ideas")).toBeVisible();
});

test("keeps every change after a reload", async ({ page }) => {
  const backlog = page.getByTestId("column-col-backlog");

  await backlog.getByRole("button", { name: /add card/i }).click();
  await backlog.getByPlaceholder("Card title").fill("Persisted card");
  await saved(page, () => backlog.getByRole("button", { name: /add card/i }).click());

  const card = page.getByTestId("card-card-3");
  await card.getByRole("button", { name: "Edit Prototype analytics view", exact: true }).click();
  await card.getByLabel("Card title").fill("Persisted edit");
  await saved(page, () => card.getByRole("button", { name: "Save" }).click());

  await saved(page, () => dragCard(page, "card-card-1", "column-col-done"));

  await saved(page, () =>
    page.getByRole("button", { name: "Delete Gather customer signals", exact: true }).click()
  );

  const title = page.getByTestId("column-col-review").getByLabel("Column title");
  await title.fill("QA");
  await saved(page, () => title.press("Enter"));

  await page.reload();

  await expect(backlog.getByText("Persisted card")).toBeVisible();
  await expect(page.getByTestId("card-card-3").getByText("Persisted edit")).toBeVisible();
  await expect(page.getByTestId("column-col-done").getByTestId("card-card-1")).toBeVisible();
  await expect(page.getByText("Gather customer signals")).toHaveCount(0);
  await expect(page.getByTestId("column-col-review").getByLabel("Column title")).toHaveValue("QA");
});

test("loads without console errors", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  expect(errors).toEqual([]);
});
