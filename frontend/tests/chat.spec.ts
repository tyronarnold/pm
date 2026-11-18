import { expect, test } from "@playwright/test";
import { resetBoard, signIn } from "./helpers";

// Does not call the AI: the chat request is answered with the error the backend sends on an AI timeout.
test("shows the server's message when the AI call fails", async ({ page }) => {
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ detail: "The AI took too long to reply. Please try again." }),
    })
  );
  await signIn(page);
  const chat = page.getByRole("complementary", { name: "AI chat" });
  await chat.getByLabel("Message", { exact: true }).fill("Hello");
  await chat.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByText("The AI took too long to reply. Please try again.")).toBeVisible();
});

// Calls the real AI through the running container (uses its OPENROUTER_API_KEY).
test("AI chat creates a card and moves it to Done", async ({ page }) => {
  await signIn(page);
  await expect(page.locator('[data-testid^="column-"]')).toHaveCount(5);
  await resetBoard(page);
  await page.reload();

  const chat = page.getByRole("complementary", { name: "AI chat" });
  await chat
    .getByLabel("Message", { exact: true })
    .fill('Create a card titled "Chat e2e card" in Backlog, then move it to Done.');
  await chat.getByRole("button", { name: "Send" }).click();

  const done = page.getByTestId("column-col-done");
  await expect(done.getByText("Chat e2e card")).toBeVisible({ timeout: 45_000 });
  await expect(chat.getByRole("log").locator("p")).toHaveCount(2);
  await expect(page.getByTestId("column-col-backlog").getByText("Chat e2e card")).toHaveCount(0);

  await page.reload();
  await expect(done.getByText("Chat e2e card")).toBeVisible();
});
