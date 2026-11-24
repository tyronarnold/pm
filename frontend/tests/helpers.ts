import { expect, type Page } from "@playwright/test";
import { initialData } from "../src/lib/kanban";

export const signIn = async (page: Page, password = "password", username = "user") => {
  await page.goto("/");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
};

// Creates an account with a name no other test uses, and leaves it signed in.
export const registerNewUser = async (page: Page, password = "e2e-password") => {
  const username = `e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await page.goto("/");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText(`Signed in as ${username}`)).toBeVisible();
  return username;
};

// Leaves the signed-in user with one board, "My first board", holding the demo cards.
export const resetBoard = async (page: Page) => {
  const boards: { id: number }[] = await (await page.request.get("/api/boards")).json();
  let id = boards[0]?.id;
  for (const board of boards.slice(1)) {
    expect((await page.request.delete(`/api/boards/${board.id}`)).ok()).toBe(true);
  }
  if (id === undefined) {
    id = (await (await page.request.post("/api/boards", { data: { name: "My first board" } })).json()).id;
  }
  expect((await page.request.patch(`/api/boards/${id}`, { data: { name: "My first board" } })).ok()).toBe(true);
  const { version } = await (await page.request.get(`/api/boards/${id}`)).json();
  const response = await page.request.put(`/api/boards/${id}`, { data: { version, board: initialData } });
  expect(response.ok()).toBe(true);
};

// Runs an action and waits until the board it triggers has been saved.
export const saved = async (page: Page, action: () => Promise<void>) => {
  const response = page.waitForResponse(
    (r) => /\/api\/boards\/\d+$/.test(r.url()) && r.request().method() === "PUT"
  );
  await action();
  expect((await response).ok()).toBe(true);
};
