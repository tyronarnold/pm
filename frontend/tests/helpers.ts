import { expect, type Page } from "@playwright/test";
import { initialData } from "../src/lib/kanban";

export const signIn = async (page: Page, password = "password") => {
  await page.goto("/");
  await page.getByLabel("Username").fill("user");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

// Replaces the signed-in user's saved board with the demo board.
export const resetBoard = async (page: Page) => {
  const response = await page.request.put("/api/board", { data: initialData });
  expect(response.ok()).toBe(true);
};

// Runs an action and waits until the board it triggers has been saved.
export const saved = async (page: Page, action: () => Promise<void>) => {
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/api/board") && r.request().method() === "PUT"
  );
  await action();
  expect((await response).ok()).toBe(true);
};
