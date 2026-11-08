import { expect, type Page, test } from "@playwright/test";

// The Night call on the physical handset. Runs against the labeled fixture.
type W = { rects: unknown[]; mode: string; callPhase: string; phoneState: string; audioState: { active: boolean; state: string }; introActive: boolean; toggleView(): void; firstPerson: boolean };
declare const window: Window & { __world: W };
const out = process.env.WORLD_EVIDENCE_DIR ?? "test-results/world";
const shot = process.env.CAPTURE_LABEL;
const snap = async (page: Page, name: string) => { if (shot) await page.screenshot({ path: `${out}/${shot}/${name}.png` }); };
const open = async (page: Page, url: string) => {
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
};
const phase = (page: Page, value: string, timeout = 20_000) => expect.poll(() => page.evaluate(() => window.__world.callPhase), { timeout }).toBe(value);
test.use({ viewport: { width: 1600, height: 900 } });

test("wake, pick up, accept, captions one at a time, end, stand and walk", async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await open(page, "/night/3d?fixture=1&worldDebug=1");
  await expect.poll(() => page.evaluate(() => window.__world.phoneState)).toBe("ringing");
  expect(await page.evaluate(() => window.__world.audioState.active)).toBe(true);
  await expect(page.getByRole("button", { name: "Use 2D view" })).toHaveCount(0);
  await expect(page.locator(".world-panel")).toBeHidden();
  await page.waitForTimeout(600); await snap(page, "01-eyes-closed");
  await page.waitForTimeout(3000); await snap(page, "02-eyes-open");
  await phase(page, "reach"); await page.waitForTimeout(800); await snap(page, "03-reach");
  await phase(page, "lift"); await page.waitForTimeout(650); await snap(page, "04-lift");
  await phase(page, "held");
  const accept = page.getByRole("button", { name: "Accept" });
  await expect(accept).toBeVisible();
  await expect(accept).toBeFocused();
  await expect(page.getByRole("button", { name: "Snooze" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Answer Dana" })).toHaveCount(0);
  await page.waitForTimeout(300); await snap(page, "05-incoming");

  await accept.click();
  expect(await page.evaluate(() => window.__world.audioState.active)).toBe(false);
  await expect(page.getByRole("timer")).toBeVisible();
  await page.waitForTimeout(900); await snap(page, "06-sitting-up");
  await page.waitForTimeout(1300); await snap(page, "07-active");
  await page.getByRole("button", { name: "Live Conversation" }).click();
  await expect(page.locator(".phone-log b")).toHaveCount(1, { timeout: 6000 });
  await expect(page.locator(".phone-log b")).toHaveCount(2, { timeout: 6000 });
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await snap(page, "08-live");
  await page.getByRole("button", { name: "Back to call" }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__world.phoneState)).toBe("none");
  await page.waitForTimeout(500); await snap(page, "09-placing");
  await phase(page, "idle");
  await expect.poll(() => page.evaluate(() => window.__world.mode)).toBe("seated");
  await page.waitForTimeout(300); await snap(page, "10-seated-first");
  await page.evaluate(() => window.__world.toggleView());
  await page.waitForTimeout(900); await snap(page, "11-seated-third");
  await expect(page.locator(".world-objective")).toContainText("computer");
  await page.locator("canvas").focus();
  await page.keyboard.press("e");
  await expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 8000 }).toBe("walk");
  await page.waitForTimeout(700); await snap(page, "12-standing");
  expect(errors).toEqual([]);
});

test("skip reaches the same handset, snooze stops the ring, and leaving stops all sound", async ({ page }) => {
  await open(page, "/night/3d?fixture=1&worldDebug=1");
  await expect(page.getByRole("button", { name: "Skip wake-up" })).toBeVisible();
  await page.getByRole("button", { name: "Skip wake-up" }).click();
  await phase(page, "held", 3000);
  await page.getByRole("button", { name: "Snooze" }).click();
  await expect.poll(() => page.evaluate(() => window.__world.audioState.active)).toBe(false);
  await expect(page.getByText("Snoozed")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__world.audioState.active), { timeout: 8000 }).toBe(true);
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByRole("timer")).toBeVisible();
});

test("the handset fits a phone-sized window", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await open(page, "/night/3d?fixture=1&worldDebug=1&noIntro=1");
  await phase(page, "held");
  const box = await page.locator(".world-phone").boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(box!.y + box!.height).toBeLessThanOrEqual(780);
  for (const name of ["Accept", "Snooze"]) {
    const button = await page.getByRole("button", { name }).boundingBox();
    expect(button!.x).toBeGreaterThanOrEqual(box!.x);
    expect(button!.y + button!.height).toBeLessThanOrEqual(box!.y + box!.height);
  }
  await snap(page, "narrow");
});

test("reduced motion reaches the same call and return", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, "/night/3d?fixture=1&worldDebug=1");
  await phase(page, "held", 5000);
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await phase(page, "idle", 5000);
  await expect.poll(() => page.evaluate(() => window.__world.mode)).toBe("seated");
});
