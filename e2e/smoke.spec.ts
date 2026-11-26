import { expect, test } from "@playwright/test";

test("a moderated question travels from participant to presenter screen", async ({ browser }) => {
  // Demo data lives in one tab, so a single page switches persona for each role.
  const page = await (await browser.newContext()).newPage();
  await page.goto("/");
  await expect(page.getByText("Demo mode.")).toBeVisible();

  // Participant asks; the room moderates, so the question is held.
  await page.getByRole("button", { name: /Dev Rao/ }).click();
  await page.getByRole("link", { name: /Platform Summit/ }).click();
  await page.getByLabel("Your question").fill("Will the keynote slides be shared?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(/A moderator will review it/)).toBeVisible();
  const mine = page.getByRole("listitem").filter({ hasText: "Will the keynote slides be shared?" });
  await expect(mine.getByText("Awaiting review")).toBeVisible();

  // Moderator approves it from the queue and puts it on screen.
  await page.getByLabel("Demo user").selectOption("demo_ben");
  await page.getByRole("tab", { name: /Moderation/ }).click();
  const queued = page.getByRole("listitem").filter({ hasText: "Will the keynote slides be shared?" });
  await queued.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("tab", { name: "Questions" }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Will the keynote slides be shared?" })
    .getByRole("button", { name: "Show on screen" })
    .click();

  // Presenter view shows it, next to the live poll.
  await page.getByRole("link", { name: "Presenter view" }).click();
  await expect(page.getByRole("blockquote")).toContainText("Will the keynote slides be shared?");
  await expect(page.getByText("Which topic should the next workshop cover?")).toBeVisible();

  // The audience sees it as an open question and can upvote it.
  await page.getByRole("link", { name: "Exit presenter view" }).click();
  await page.getByLabel("Demo user").selectOption("demo_cleo");
  const open = page.getByRole("listitem").filter({ hasText: "Will the keynote slides be shared?" });
  await open.getByRole("button", { name: /^Upvote/ }).click();
  await expect(open.getByRole("button", { name: /Remove your upvote/ })).toHaveAttribute("aria-pressed", "true");

  // The same screen still fits a phone without horizontal scrolling.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(page.getByRole("heading", { level: 1, name: /Platform Summit/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
