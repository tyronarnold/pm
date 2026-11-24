import { expect, test, type Page } from "@playwright/test";
import { registerNewUser, saved } from "./helpers";

// Each test uses its own new account, so column changes do not affect other tests.
test.beforeEach(async ({ page }) => {
  await registerNewUser(page);
});

const columnTitles = (page: Page) =>
  page.getByLabel("Column title").evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));

const addColumn = async (page: Page, title: string) => {
  await page.getByRole("button", { name: "Add column" }).click();
  await page.getByLabel("New column title").fill(title);
  await saved(page, () => page.getByRole("button", { name: "Add column" }).click());
};

test("adds, reorders and deletes columns, and keeps them after a reload", async ({ page }) => {
  await addColumn(page, "Blocked");
  const blocked = page.locator('[data-testid^="column-"]').last();
  await blocked.getByRole("button", { name: /add card/i }).click();
  await blocked.getByLabel("Card title").fill("Waiting on legal");
  await saved(page, () => blocked.getByRole("button", { name: /add card/i }).click());

  // Hover reveals the column controls on mouse devices.
  const blockedColumn = page.locator("section", { has: page.getByText("Waiting on legal") }).first();
  await blockedColumn.hover();
  await saved(page, () => page.getByRole("button", { name: "Move Blocked column left" }).click());
  await expect.poll(() => columnTitles(page)).toEqual(["Backlog", "Discovery", "In Progress", "Review", "Blocked", "Done"]);

  // Review has one card: delete it, then the column can go.
  await saved(page, () => page.getByRole("button", { name: "Delete QA micro-interactions", exact: true }).click());
  await page.getByTestId("column-col-review").hover();
  await saved(page, () => page.getByRole("button", { name: "Delete Review column" }).click());

  await page.reload();
  await expect.poll(() => columnTitles(page)).toEqual(["Backlog", "Discovery", "In Progress", "Blocked", "Done"]);
  await expect(page.getByText("Waiting on legal")).toBeVisible();
});

test("a column with cards cannot be deleted", async ({ page }) => {
  await page.getByTestId("column-col-done").hover();
  await expect(page.getByRole("button", { name: "Delete Done column" })).toBeDisabled();
});

test("many columns scroll sideways and cards can be dragged to the last one", async ({ page }) => {
  for (const title of ["QA", "Staging", "Released"]) {
    await addColumn(page, title);
  }
  const last = page.locator('[data-testid^="column-"]').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last.getByLabel("Column title")).toHaveValue("Released");

  const card = page.getByTestId("card-card-7");
  await card.scrollIntoViewIfNeeded();
  const from = await card.boundingBox();
  await last.scrollIntoViewIfNeeded();
  const to = await last.boundingBox();
  if (!from || !to) {
    throw new Error("Unable to resolve drag coordinates.");
  }
  await saved(page, async () => {
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 12 });
    await page.mouse.up();
  });
  await expect(last.getByTestId("card-card-7")).toBeVisible();
});
