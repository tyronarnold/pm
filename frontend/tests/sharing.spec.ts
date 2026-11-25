import { expect, test, type Browser, type Page } from "@playwright/test";
import { registerNewUser, saved } from "./helpers";

// Two people, each in their own browser context (separate cookies), with new accounts.
const twoUsers = async (browser: Browser) => {
  const owner = await (await browser.newContext()).newPage();
  const member = await (await browser.newContext()).newPage();
  return {
    owner,
    member,
    ownerName: await registerNewUser(owner),
    memberName: await registerNewUser(member),
  };
};

const shareWith = async (page: Page, username: string) => {
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const panel = page.getByRole("region", { name: "Sharing" });
  await panel.getByLabel("Share with (username)").fill(username);
  await panel.getByRole("button", { name: "Share", exact: true }).click();
  await expect(panel.getByText(username, { exact: true })).toBeVisible();
  return panel;
};

const boardSelect = (page: Page) => page.getByRole("combobox", { name: "Board" });

test("a shared board can be opened and edited by the member", async ({ browser }) => {
  const { owner, member, ownerName, memberName } = await twoUsers(browser);
  await shareWith(owner, memberName);

  await member.reload();
  const sharedLabel = `My first board (shared by ${ownerName})`;
  await boardSelect(member).selectOption({ label: sharedLabel });
  await expect(boardSelect(member).locator("option:checked")).toHaveText(sharedLabel);
  await expect(member.getByRole("button", { name: "Rename board" })).toHaveCount(0);
  await expect(member.getByRole("button", { name: "Delete board" })).toHaveCount(0);

  const card = member.getByTestId("card-card-1");
  await card.getByRole("button", { name: "Edit Align roadmap themes", exact: true }).click();
  await card.getByLabel("Card title").fill("Edited by the member");
  await saved(member, () => card.getByRole("button", { name: "Save" }).click());

  await owner.reload();
  await expect(owner.getByText("Edited by the member")).toBeVisible();
});

test("the owner removes a member, who then loses access", async ({ browser }) => {
  const { owner, member, memberName } = await twoUsers(browser);
  const panel = await shareWith(owner, memberName);
  const sharedUrl = owner.url();

  await panel.getByRole("button", { name: `Remove ${memberName}` }).click();
  await expect(panel.getByText("Not shared with anyone yet.")).toBeVisible();

  await member.goto(sharedUrl);
  await expect(boardSelect(member).locator("option")).toHaveCount(1);
  await expect(boardSelect(member).locator("option:checked")).toHaveText("My first board");
});

test("a member leaves a shared board", async ({ browser }) => {
  const { owner, member, ownerName, memberName } = await twoUsers(browser);
  await shareWith(owner, memberName);
  await member.goto(owner.url());
  await expect(boardSelect(member).locator("option:checked")).toHaveText(`My first board (shared by ${ownerName})`);

  member.once("dialog", (dialog) => dialog.accept());
  await member.getByRole("button", { name: "Members" }).click();
  await member.getByRole("region", { name: "Sharing" }).getByRole("button", { name: "Leave board" }).click();
  await expect(boardSelect(member).locator("option")).toHaveCount(1);

  await owner.getByRole("region", { name: "Sharing" }).getByRole("button", { name: "Close" }).click();
  await owner.getByRole("button", { name: "Share", exact: true }).click();
  await expect(owner.getByText("Not shared with anyone yet.")).toBeVisible();
});

test("sharing with an unknown user shows why it failed", async ({ page }) => {
  await registerNewUser(page);
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const panel = page.getByRole("region", { name: "Sharing" });
  await panel.getByLabel("Share with (username)").fill("no-such-user-here");
  await panel.getByRole("button", { name: "Share", exact: true }).click();
  await expect(panel.getByText('There is no user called "no-such-user-here".')).toBeVisible();
});

test("the owner assigns a card to a member, who finds it under their name", async ({ browser }) => {
  const { owner, member, memberName } = await twoUsers(browser);
  await shareWith(owner, memberName);

  const card = owner.getByTestId("card-card-1");
  await card.getByRole("button", { name: "Edit Align roadmap themes", exact: true }).click();
  await card.getByLabel("Assignee").selectOption(memberName);
  await saved(owner, () => card.getByRole("button", { name: "Save" }).click());
  await expect(card.getByLabel(`Assigned to ${memberName}`)).toBeVisible();

  await member.goto(owner.url());
  await member.getByLabel("Filter by assignee").selectOption({ label: `${memberName} (me)` });
  await expect(member.locator('[data-testid^="card-"]')).toHaveCount(1);
  await expect(member.getByTestId("card-card-1")).toBeVisible();

  await member.getByRole("button", { name: "Overview" }).click();
  await expect(member.getByRole("region", { name: "Overview" }).getByText("1 assigned to you")).toBeVisible();
});

test("the owner sees a member's change without reloading", async ({ browser }) => {
  const { owner, member, memberName } = await twoUsers(browser);
  await shareWith(owner, memberName);
  await owner.getByRole("region", { name: "Sharing" }).getByRole("button", { name: "Close" }).click();

  await member.goto(owner.url());
  const card = member.getByTestId("card-card-6");
  await card.getByRole("button", { name: "Edit QA micro-interactions", exact: true }).click();
  await card.getByLabel("Card title").fill("Changed live by the member");
  await saved(member, () => card.getByRole("button", { name: "Save" }).click());

  // The owner's page checks for changes every few seconds.
  await expect(owner.getByText("Changed live by the member")).toBeVisible({ timeout: 15_000 });
});
