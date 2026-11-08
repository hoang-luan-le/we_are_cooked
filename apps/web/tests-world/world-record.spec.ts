import { expect, type Page, test } from "@playwright/test";

// The two uninterrupted review recordings. Uses keyboard, wheel and on-screen buttons. Skipped unless requested.
test.skip(!process.env.CAPTURE_RECORD, "Set CAPTURE_RECORD and CAPTURE_VIDEO to record.");
type W = { rects: unknown[]; mode: string };
declare const window: Window & { __world: W };
const ready = (page: Page) => expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
const mode = (page: Page, value: string) => expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 20_000 }).toBe(value);
const hold = async (page: Page, key: string, ms: number) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const scroll = async (page: Page, dy: number, count: number) => { await page.mouse.move(500, 150); for (let i = 0; i < count; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(220); } };
const goTo = async (page: Page, label: string) => {
  const menu = page.locator(".world-goto");
  if (!(await menu.getAttribute("open").catch(() => null))) await menu.locator("summary").click();
  await menu.getByRole("button", { name: label }).click();
};

test("Night: wake-up, handset, call, seated, stand, camera switch, sit, board, seated, stand", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/night/3d?fixture=1&worldDebug=1");
  await ready(page);
  const phase = (v: string) => expect.poll(() => page.evaluate(() => (window.__world as unknown as { callPhase: string }).callPhase), { timeout: 25_000 }).toBe(v);
  await phase("held");
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "Accept" }).click();
  await page.waitForTimeout(2600);
  await page.getByRole("button", { name: "Live Conversation" }).click();
  await expect(page.locator(".phone-log b")).toHaveCount(2, { timeout: 8000 });
  await page.waitForTimeout(3600);
  await page.getByRole("button", { name: "Back to call" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "End", exact: true }).click();
  await phase("idle");
  await mode(page, "seated");
  await page.waitForTimeout(900);
  await scroll(page, 100, 3);
  await page.waitForTimeout(1100);
  await page.locator("canvas").focus();
  await page.keyboard.press("e");
  await mode(page, "walk");
  await page.waitForTimeout(500);
  await hold(page, "d", 700);
  await hold(page, "w", 900);
  await goTo(page, "Sit at the computer");
  await expect(page.locator(".world-panel-bar strong")).toHaveText("Incident board", { timeout: 20_000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Back to the room" }).click();
  await mode(page, "seated");
  await page.waitForTimeout(1200);
  await page.keyboard.press("e");
  await mode(page, "walk");
  await page.locator("canvas").focus();
  await hold(page, "s", 1200);
  await page.waitForTimeout(800);
});

test("Morning: exterior, lobby, door, minimap, meeting, both workstations", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/morning/3d?fixture=1&worldDebug=1&role=author");
  await ready(page);
  await page.waitForTimeout(1200);
  await page.locator("canvas").focus();
  await scroll(page, 100, 3);
  await page.waitForTimeout(700);
  await hold(page, "w", 1500);
  await page.keyboard.press("e");
  await page.waitForTimeout(700);
  await hold(page, "w", 2200);
  await page.waitForTimeout(400);
  await goTo(page, "Sit for the briefing");
  await expect(page.locator(".world-panel-bar strong")).toHaveText("Dana's briefing", { timeout: 20_000 });
  for (let i = 0; i < 2; i++) { await page.waitForTimeout(1300); await page.locator(".meeting").getByRole("button", { name: "Next", exact: true }).click(); }
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Back to the room" }).click();
  await mode(page, "seated");
  await page.waitForTimeout(2200); // The room, Dana and the projector together.
  await page.getByRole("button", { name: "Open the panel again" }).click();
  await page.waitForTimeout(900);
  await page.locator(".meeting").getByRole("button", { name: "Skip to the next objective" }).click();
  await page.waitForTimeout(800);
  await page.locator(".meeting").getByRole("button", { name: "Finish the meeting" }).click();
  await mode(page, "seated");
  await page.waitForTimeout(2500); // The teammate walks out.
  await goTo(page, "Sit at workstation 1");
  await expect(page.locator(".world-panel-bar strong")).toHaveText("Workstation 1", { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Back to the room" }).click();
  await mode(page, "seated");
  await page.waitForTimeout(1000);
  await goTo(page, "Sit at workstation 2");
  await expect(page.locator(".world-panel-bar strong")).toHaveText("Workstation 2", { timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Back to the room" }).click();
  await mode(page, "seated");
  await page.keyboard.press("e");
  await mode(page, "walk");
  await page.waitForTimeout(800);
});
