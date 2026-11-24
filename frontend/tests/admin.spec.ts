import { expect, test, type Browser, type Page } from "@playwright/test";
import { registerNewUser, signIn } from "./helpers";

// The demo account `user` is the admin in the test container. Each test creates its own
// other account in a separate browser context, and never removes `user`'s admin role.
const adminAndUser = async (browser: Browser) => {
  const admin = await (await browser.newContext()).newPage();
  const other = await (await browser.newContext()).newPage();
  const otherName = await registerNewUser(other);
  await signIn(admin);
  await expect(admin.getByText("Signed in as user")).toBeVisible();
  return { admin, other, otherName };
};

const openUsers = async (page: Page, username: string) => {
  await page.getByRole("button", { name: "Admin" }).click();
  const panel = page.getByRole("region", { name: "Users" });
  await expect(panel.getByRole("cell", { name: username, exact: true })).toBeVisible();
  return panel;
};

test("only admins see the admin panel", async ({ browser }) => {
  const { admin, other } = await adminAndUser(browser);
  await expect(admin.getByRole("button", { name: "Admin" })).toBeVisible();
  await expect(other.getByRole("button", { name: "Admin" })).toHaveCount(0);
  expect((await other.request.get("/api/admin/users")).status()).toBe(403);
});

test("an admin makes another user an admin", async ({ browser }) => {
  const { admin, other, otherName } = await adminAndUser(browser);
  const panel = await openUsers(admin, otherName);
  await panel.getByRole("button", { name: `Make admin ${otherName}` }).click();
  await expect(panel.getByText(`${otherName} is now an admin.`)).toBeVisible();

  await other.reload();
  await expect(other.getByRole("button", { name: "Admin" })).toBeVisible();

  await panel.getByRole("button", { name: `Remove admin from ${otherName}` }).click();
  await expect(panel.getByText(`${otherName} is no longer an admin.`)).toBeVisible();
});

test("an admin resets a password, which signs the user out", async ({ browser }) => {
  const { admin, other, otherName } = await adminAndUser(browser);
  const panel = await openUsers(admin, otherName);
  await panel.getByRole("button", { name: `Reset password for ${otherName}` }).click();
  await panel.getByLabel(`New password for ${otherName}`).fill("reset-by-admin");
  await panel.getByRole("button", { name: "Set password", exact: true }).click();
  await expect(panel.getByText(`${otherName}'s password has been reset`)).toBeVisible();

  await other.reload();
  await expect(other.getByRole("button", { name: "Sign in" })).toBeVisible();
  await signIn(other, "reset-by-admin", otherName);
  await expect(other.getByText(`Signed in as ${otherName}`)).toBeVisible();
});

test("an admin deletes a user", async ({ browser }) => {
  const { admin, other, otherName } = await adminAndUser(browser);
  const panel = await openUsers(admin, otherName);
  admin.once("dialog", (dialog) => dialog.accept());
  await panel.getByRole("button", { name: `Delete ${otherName}` }).click();
  await expect(panel.getByText(`${otherName} has been deleted.`)).toBeVisible();
  await expect(panel.getByRole("cell", { name: otherName, exact: true })).toHaveCount(0);

  await other.reload();
  await expect(other.getByRole("button", { name: "Sign in" })).toBeVisible();
});
