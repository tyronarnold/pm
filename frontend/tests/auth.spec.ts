import { expect, test } from "@playwright/test";
import { registerNewUser, signIn } from "./helpers";

const columns = '[data-testid^="column-"]';

test("shows the login form when signed out", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  await expect(page.locator(columns)).toHaveCount(0);
});

test("rejects invalid credentials", async ({ page }) => {
  await signIn(page, "wrong");
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await expect(page.locator(columns)).toHaveCount(0);
});

test("signs in, stays signed in on reload, and logs out", async ({ page }) => {
  await signIn(page);
  await expect(page.locator(columns)).toHaveCount(5);

  await page.reload();
  await expect(page.locator(columns)).toHaveCount(5);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("offers a retry when the board fails to load", async ({ page }) => {
  let failBoardLoad = true;
  await page.route("**/api/boards", (route) =>
    failBoardLoad && route.request().method() === "GET"
      ? route.fulfill({ status: 500, body: "{}" })
      : route.continue()
  );
  await signIn(page);
  await expect(page.getByText("Could not load your board.")).toBeVisible();

  failBoardLoad = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.locator(columns)).toHaveCount(5);
});

test("protected API returns 401 when signed out", async ({ request }) => {
  const response = await request.get("/api/me");
  expect(response.status()).toBe(401);
});

test("creates an account, signs out and signs back in to it", async ({ page }) => {
  const username = await registerNewUser(page);
  await expect(page.locator(columns)).toHaveCount(5);
  await expect(page.getByRole("combobox", { name: "Board" })).toHaveValue(/\d+/);
  await expect(page.getByText("Align roadmap themes")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page, "e2e-password", username);
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
});

test("an account cannot be created with a taken username", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill("some-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("That username is already taken.")).toBeVisible();
});

test("changes the password", async ({ page }) => {
  const username = await registerNewUser(page);
  await page.getByRole("button", { name: "Account" }).click();
  const settings = page.getByRole("region", { name: "Account settings" });
  await settings.getByLabel("Current password").fill("e2e-password");
  await settings.getByLabel("New password").fill("changed-password");
  await settings.getByRole("button", { name: "Change password" }).click();
  await expect(settings.getByText("Your password has been changed.")).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page, "e2e-password", username);
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
  await signIn(page, "changed-password", username);
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
});

test("deletes the account", async ({ page }) => {
  const username = await registerNewUser(page);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Account" }).click();
  const settings = page.getByRole("region", { name: "Account settings" });
  await settings.getByLabel("Password", { exact: true }).fill("e2e-password");
  await settings.getByRole("button", { name: "Delete account" }).click();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  await signIn(page, "e2e-password", username);
  await expect(page.getByText("Invalid username or password.")).toBeVisible();
});

test("users only see their own boards", async ({ page }) => {
  await registerNewUser(page);
  await page.getByRole("button", { name: "Rename board" }).click();
  await page.getByLabel("Board name").fill("Private plans");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByRole("combobox", { name: "Board" })).toContainText("Private plans");
  const url = page.url();

  await page.getByRole("button", { name: "Log out" }).click();
  await signIn(page);
  await expect(page.getByText("Signed in as user")).toBeVisible();
  await page.goto(url); // the other user's board id is in this URL
  await expect(page.getByText("Signed in as user")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Board" })).not.toContainText("Private plans");
});
