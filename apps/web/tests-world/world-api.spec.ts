import { expect, type Page, test } from "@playwright/test";
import type { IncidentState } from "../../../packages/contracts/types";

// Local API evidence, kept apart from world.spec.ts (fixture). Real FastAPI on loopback, GitHub fixture, scripted Dana relay.
const api = process.env.NIGHT_TEST_API_ORIGIN;
const evidence = process.env.WORLD_EVIDENCE_DIR ?? "test-results/world";
const headers = { "X-Demo-User": "demo-a" };
declare const window: Window & { __world: { rects: unknown[]; mode: string; goTo(id: string): void } };

async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
}
const waitMode = (page: Page, mode: string) => expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 10_000 }).toBe(mode);
async function goSit(page: Page, id: string) {
  await waitMode(page, "walk");
  await page.evaluate(target => window.__world.goTo(target), id);
  await expect(page.getByRole("button", { name: "Back to the room" })).toBeVisible({ timeout: 10_000 });
}
async function leaveSeat(page: Page) {
  await page.getByRole("button", { name: "Back to the room" }).click();
  await waitMode(page, "seated");
  await page.keyboard.press("e");
  await waitMode(page, "walk");
}

test("3D Night and Morning drive the real incident through the shared actions", async ({ page, request }) => {
  test.skip(!api, "Needs the local FastAPI fixture.");
  const created = await request.post(`${api}/api/incident/start`, { headers, data: { level: "explore" } });
  expect(created.status()).toBe(201);
  const { incident_id: id }: IncidentState = await created.json();
  const state = async (): Promise<IncidentState> => (await request.get(`${api}/api/incident/${id}`, { headers })).json();

  // Bedroom: Answer through the HTML control in the scene.
  await page.goto(`/night/3d?incident=${id}&worldDebug=1&noIntro=1`);
  await ready(page);
  expect((await state()).phase).toBe("paged");
  await page.getByRole("button", { name: "Accept" }).click();
  await expect.poll(async () => (await state()).phase).not.toBe("paged");
  await expect(page.getByRole("button", { name: "End", exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });

  // Computer opens the same board. Rollback goes through the same API action.
  await goSit(page, "computer");
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
  await page.getByRole("button", { name: "Roll back to v2.13.9" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm rollback" }).click();
  await expect.poll(async () => (await state()).status, { timeout: 15_000 }).toBe("rolled_back");
  await page.screenshot({ path: `${evidence}/api-bedroom-rollback.png` });

  await expect.poll(async () => (await state()).phase, { timeout: 20_000 }).toBe("stabilized");

  const handoff = await request.post(`${api}/api/incident/${id}/handoff`, { headers, data: {
    what_happened: "Guest checkout failed during the sale.",
    current_state: "Checkout recovered after rollback and discounts are off.",
    tried: "Rolled back to v2.13.9.",
    risks: "The permanent fix needs a guest checkout regression test.",
    morning_pair: ["demo-b"],
  } });
  expect(handoff.ok()).toBe(true);
  await expect.poll(async () => { await page.getByRole("button", { name: "Back to the room" }).isVisible(); return (await state()).handoff !== null; }).toBe(true);

  // Resuming a live incident skips the wake-up.
  await page.goto(`/night/3d?incident=${id}&worldDebug=1`);
  await ready(page);
  await expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 10_000 }).toBe("walk");
  await expect(page.getByRole("button", { name: "Skip wake-up" })).toHaveCount(0);

  // The Night link enters the office instead of leaving 3D.
  await page.evaluate(() => (window as unknown as { __world: { goTo(id: string): void } }).__world.goTo("computer"));
  await expect(page.getByRole("button", { name: "Back to the room" })).toBeVisible({ timeout: 10_000 });
  const link = page.getByRole("link", { name: "Open Morning workspace" });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/morning/3d\\?incident=${id}`));
  await page.goto(`/morning/3d?incident=${id}&worldDebug=1`);
  await ready(page);

  await goSit(page, "meeting-seat");
  await expect(page.locator(".meeting")).toContainText("Guest checkout failed during the sale.");
  await expect(page.locator(".meeting")).toContainText("Local API");
  await page.screenshot({ path: `${evidence}/api-office-briefing.png` });
  await leaveSeat(page);

  for (const desk of ["desk-1", "desk-2"]) {
    await goSit(page, desk);
    await expect(page.getByRole("heading", { name: "Fix the checkout regression" })).toBeVisible();
    await expect(page.getByText("Rehearsal GitHub fixture", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Deploy fix", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `${evidence}/api-office-${desk}.png` });
    await leaveSeat(page);
  }

  // The 2D fallback for this same incident shows the same state.
  const after = await state();
  await page.goto(`/morning/3d?incident=${id}&no3d=1`);
  await expect(page.getByRole("heading", { name: "Fix the checkout regression" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Night shift handoff" })).toContainText("Checkout recovered after rollback");
  await page.goto(`/night/3d?incident=${id}&no3d=1`);
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
  expect((await state()).status).toBe(after.status);
  await page.goto(`/incident/${id}`);
  await expect(page).toHaveURL(`/morning/3d?incident=${id}`);
});
