import { expect, test } from "@playwright/test";

test("starts a solo exercise and resumes its saved recovery after refresh", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", request => {
    if (request.method() === "POST" && new URL(request.url()).pathname.startsWith("/api/")) writes.push(request.url());
  });
  await page.goto("/");
  const start = page.getByRole("link", { name: "Start simulation" });
  await start.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Prepare for your shift." })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  await page.getByText("Explore checklist", { exact: true }).click();
  await expect(page.getByText("Compare the first error with the latest deploy.")).toBeVisible();
  await page.getByRole("radio", { name: /Practice/ }).check();
  await expect(page.getByText("Explore checklist", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Start solo exercise" }).click();
  await expect(page.getByRole("region", { name: "Saved practice exercise" })).toContainText("Practice · Solo Night 2D");
  const savedUrl = page.url();
  await page.getByRole("button", { name: "Answer Dana", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeVisible();
  await expect(page.getByRole("log", { name: "Dana captions" })).toContainText("Dana");
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
  await page.getByRole("button", { name: "Roll back to v2.13.9" }).click();
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Incident Lab" }).click();
  await page.getByRole("link", { name: "Resume saved exercise" }).click();
  await expect(page).toHaveURL(savedUrl);
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
  expect(writes).toEqual([]);
});

test.describe("mobile entry", () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 800 } });

  test("recovers from invalid and expired codes and resumes the fixture cohort", async ({ page }) => {
    await page.goto("/start");
    await page.getByRole("radio", { name: /Challenge/ }).check();
    const code = page.getByRole("textbox", { name: "Cohort code" });
    const join = page.getByRole("button", { name: "Join cohort" });
    await code.fill("unknown");
    await join.tap();
    await expect(page.getByText("That rehearsal code was not found.", { exact: false })).toBeVisible();
    await expect(code).toHaveAttribute("aria-invalid", "true");
    await code.fill("night00");
    await join.tap();
    await expect(page.getByText("This rehearsal code has expired.", { exact: false })).toBeVisible();
    expect(await page.evaluate(() => localStorage.length)).toBe(0);
    await code.fill(" night24 ");
    await join.tap();
    await expect(page.getByRole("region", { name: "Saved practice exercise" })).toContainText("Challenge · Night Investigator");
    await page.getByText("Rehearsal cohort members", { exact: true }).tap();
    await expect(page.getByText("Morgan · Morning Reviewer")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Saved practice exercise" })).toContainText("Challenge · Night Investigator");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

test("returns an unknown saved exercise to entry", async ({ page }) => {
  await page.goto("/night?fixture=1&entry=0123456789abcdef");
  await expect(page.getByRole("heading", { name: "Saved exercise unavailable" })).toBeVisible();
  await page.getByRole("link", { name: "Back to simulation entry" }).click();
  await expect(page.getByRole("heading", { name: "Prepare for your shift." })).toBeVisible();
});

test("updates the resume link and invalidates a replaced exercise in another tab", async ({ page, context }) => {
  await page.goto("/start");
  await page.getByRole("button", { name: "Start solo exercise" }).click();
  await expect(page.getByRole("heading", { name: "Dana is calling." })).toBeVisible();
  const oldUrl = page.url();
  const entry = await context.newPage();
  await entry.goto("/start");
  const resume = entry.getByRole("link", { name: "Resume saved exercise" });
  await expect(resume).toHaveAttribute("href", new URL(oldUrl).pathname + new URL(oldUrl).search);

  const replacement = await context.newPage();
  await replacement.goto("/start");
  await replacement.getByRole("radio", { name: /Challenge/ }).check();
  await replacement.getByRole("button", { name: "Start solo exercise" }).click();
  await expect(replacement.getByRole("heading", { name: "Dana is calling." })).toBeVisible();
  await expect(entry.getByRole("region", { name: "Resume your exercise" })).toContainText("Challenge");
  await expect(page.getByRole("heading", { name: "Saved exercise unavailable" })).toBeVisible();

  await resume.click();
  await expect(entry).toHaveURL(replacement.url());
});

test("rejects ambiguous saved links and resumes a legacy completed briefing", async ({ page }) => {
  await page.goto("/start");
  await page.evaluate(() => localStorage.setItem("incident-lab.fixture-entry.v1", JSON.stringify({
    id: "0123456789abcdef", level: "practice", kind: "solo", answered: true, rollbackAt: null,
  })));
  await page.goto("/night?fixture=1&entry=0123456789abcdef&entry=bad");
  await expect(page.getByRole("heading", { name: "Saved exercise unavailable" })).toBeVisible();
  await page.goto("/night?entry=0123456789abcdef");
  await expect(page.getByRole("heading", { name: "Saved exercise unavailable" })).toBeVisible();
  await page.goto("/night?fixture=1&entry=0123456789abcdef");
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
});

test("stays on entry if storage rejects the save", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Blocked storage", "QuotaExceededError"); };
  });
  await page.goto("/start");
  const start = page.getByRole("button", { name: "Start solo exercise" });
  await start.click();
  await expect(page.getByRole("alert").filter({ hasText: "could not save the exercise" })).toBeVisible();
  await expect(start).toBeEnabled();
  await expect(page).toHaveURL("/start");
});
