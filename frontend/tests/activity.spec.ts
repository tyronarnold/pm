import { expect, test, type Page } from "@playwright/test";
import { registerNewUser, saved } from "./helpers";

const changes = (page: Page) =>
  page.getByRole("region", { name: "Activity" }).getByRole("list", { name: "Changes" }).getByRole("listitem");

test("the activity log records changes to the board", async ({ page }) => {
  const username = await registerNewUser(page);

  const backlog = page.getByTestId("column-col-backlog");
  await backlog.getByRole("button", { name: /add card/i }).click();
  await backlog.getByLabel("Card title").fill("Book the venue");
  await saved(page, () => backlog.getByRole("button", { name: /add card/i }).click());

  const card = page.getByTestId("card-card-6");
  await card.getByRole("button", { name: "Edit QA micro-interactions", exact: true }).click();
  await card.getByLabel("Priority").selectOption("high");
  await saved(page, () => card.getByRole("button", { name: "Save" }).click());

  await page.getByRole("button", { name: "Activity" }).click();
  await expect(changes(page)).toHaveCount(3);
  await expect(changes(page).nth(0)).toContainText(`${username} edited "QA micro-interactions"`);
  await expect(changes(page).nth(1)).toContainText(`${username} added card "Book the venue" to "Backlog"`);
  await expect(changes(page).nth(2)).toContainText(`${username} created the board`);
});

test("a member's changes appear in the owner's activity log", async ({ browser }) => {
  const owner = await (await browser.newContext()).newPage();
  const member = await (await browser.newContext()).newPage();
  await registerNewUser(owner);
  const memberName = await registerNewUser(member);

  await owner.getByRole("button", { name: "Share", exact: true }).click();
  await owner.getByLabel("Share with (username)").fill(memberName);
  await owner.getByRole("region", { name: "Sharing" }).getByRole("button", { name: "Share", exact: true }).click();
  await expect(owner.getByRole("region", { name: "Sharing" }).getByText(memberName, { exact: true })).toBeVisible();

  await member.goto(owner.url());
  await saved(member, () =>
    member.getByRole("button", { name: "Delete Gather customer signals", exact: true }).click()
  );

  await owner.getByRole("button", { name: "Activity" }).click();
  await expect(changes(owner).first()).toContainText(`${memberName} deleted card "Gather customer signals"`);
  await expect(changes(owner).nth(1)).toContainText(`shared the board with ${memberName}`);
});

test("the overview shows every board's progress and opens one", async ({ page }) => {
  await registerNewUser(page);
  await page.getByRole("button", { name: "New board" }).click();
  await page.getByLabel("New board name").fill("Launch");
  await page.getByRole("button", { name: "Create board" }).click();
  await expect(page.getByRole("combobox", { name: "Board" }).locator("option:checked")).toHaveText("Launch");

  await page.getByRole("button", { name: "Overview" }).click();
  const overview = page.getByRole("region", { name: "Overview" });
  await expect(overview.getByRole("button", { name: "Open My first board" })).toContainText("8 cards, 2 done");
  await expect(overview.getByRole("button", { name: "Open Launch" })).toContainText("0 cards, 0 done");

  await overview.getByRole("button", { name: "Open My first board" }).click();
  await expect(page.getByRole("combobox", { name: "Board" }).locator("option:checked")).toHaveText("My first board");
  await expect(page.getByRole("region", { name: "Overview" })).toHaveCount(0);
});
