import { expect, test } from "@playwright/test";
import { signIn } from "./helpers";

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
  await page.route("**/api/board", (route) =>
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
