import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// Matched before/after evidence. CAPTURE_LABEL is before or after. Skipped unless requested.
const label = process.env.CAPTURE_LABEL;
const out = `${process.env.WORLD_EVIDENCE_DIR ?? "test-results/world"}/${label}`;
if (label) mkdirSync(out, { recursive: true });
type W = { rects: unknown[]; mode: string; frameTimes: number[]; goTo(id: string): void; activate(id: string): void; stats(): Record<string, unknown>; requestedZoom: number; firstPerson: boolean };
declare const window: Window & { __world: W };

test.use({ viewport: { width: 1600, height: 900 } });
test.skip(!label, "Set CAPTURE_LABEL to capture evidence.");

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await page.waitForTimeout(900);
}
async function pose(page: Page, x: number, z: number, fx: number, fy: number, fz: number, eye = 1.6) {
  await page.evaluate(([px, pz, ax, ay, az, e]) => {
    const w = window.__world as unknown as Record<string, number>;
    const dx = ax - px, dy = ay - e, dz = az - pz, len = Math.hypot(dx, dy, dz);
    const yaw = Math.atan2(-dx, -dz), pitch = Math.asin(dy / len);
    w.x = px; w.z = pz; w.y = e; w.yaw = yaw; w.lookYaw = yaw; w.pitch = pitch; w.lookPitch = pitch; w.vx = 0; w.vz = 0;
  }, [x, z, fx, fy, fz, eye]);
  await page.locator("canvas").focus();
  await page.waitForTimeout(260);
}
const setThird = (page: Page, third: boolean) => page.evaluate(t => { const w = window.__world as unknown as { firstPerson: boolean; toggleView(): void }; if (w.firstPerson === t) w.toggleView(); }, third);

const shots = {
  bedroom: [
    ["spawn", -0.35, -0.65, -1.3, 0.82, 0.95], ["bed", 0.3, -1.4, -1.45, 0.5, -0.7], ["desk", 0.95, 0.35, 0.9, 0.95, 1.48], ["room", 1.05, 0.7, -1.0, 0.75, -1.4],
  ],
  office: [
    ["exterior", 0, -3.6, 0, 1.4, 2.5], ["lobby", -0.15, 0.3, -0.2, 1.38, 3.5], ["hallway", 0, 4.4, 0, 1.72, 8.5], ["meeting", -2.55, 7.45, -4.5, 1.52, 11.78], ["desks", 4.35, 8.85, 4.42, 1.05, 10.63],
  ],
} as const;

test("matched stills in both views", async ({ page }) => {
  for (const [scene, url] of [["bedroom", "/night/3d?fixture=1&worldDebug=1&noIntro=1"], ["office", "/morning/3d?fixture=1&worldDebug=1"]] as const) {
    await open(page, url);
    if (scene === "bedroom") {
      await page.getByRole("button", { name: "Accept" }).click();
      await page.getByRole("button", { name: "End", exact: true }).click();
      await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
      await page.waitForTimeout(300);
    } else await page.evaluate(() => { window.__world.activate("entrance"); window.__world.activate("meeting-door"); window.__world.activate("work-door"); });
    await page.waitForTimeout(600);
    for (const [name, x, z, fx, fy, fz] of shots[scene]) {
      await setThird(page, false);
      await pose(page, x, z, fx, fy, fz);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${scene}-${name}-first.png` });
      await setThird(page, true);
      await page.waitForTimeout(900);
      await page.screenshot({ path: `${out}/${scene}-${name}-third.png` });
    }
  }
});

test("seated at every chair, third person", async ({ page }) => {
  test.setTimeout(150_000);
  const seats = [["bedroom", "/night/3d?fixture=1&worldDebug=1&noIntro=1", ["computer"]], ["office", "/morning/3d?fixture=1&worldDebug=1", ["meeting-seat", "desk-1", "desk-2"]]] as const;
  for (const [scene, url, ids] of seats) {
    await open(page, url);
    if (scene === "bedroom") {
      await page.getByRole("button", { name: "Accept" }).click();
      await page.getByRole("button", { name: "End", exact: true }).click();
      await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
      await page.waitForTimeout(400);
    }
    for (const id of ids) {
      await setThird(page, true);
      await page.evaluate(i => window.__world.goTo(i), id);
      await expect(page.locator(".world-panel-bar strong")).toBeVisible({ timeout: 25_000 });
      await page.getByRole("button", { name: "Back to the room" }).click();
      await expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 15_000 }).toBe("seated");
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${out}/seated-${scene}-${id}.png` });
    }
  }
});

test("prop close-ups and the sit sequence", async ({ page }) => {
  test.setTimeout(120_000);
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  await page.evaluate(() => { window.__world.activate("entrance"); window.__world.activate("meeting-door"); window.__world.activate("work-door"); });
  await page.waitForTimeout(600);
  await setThird(page, false);
  for (const [name, x, z, fx, fy, fz, eye] of [["sofa", 1.7, 1.2, 4.5, 0.5, 2.6, 1.5], ["chair", 3.5, 8.5, 4.5, 0.55, 9.75, 1.25], ["laptop", 4.55, 7.55, 5.85, 0.85, 8.2, 1.35], ["keyboard", 4.5, 9.75, 4.5, 0.85, 10.5, 1.24], ["planter", 2.6, 2.6, 4.2, 0.7, -0.5, 1.5]] as const) {
    await pose(page, x, z, fx, fy, fz, eye);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${out}/close-${name}.png` });
  }
  await open(page, "/night/3d?fixture=1&worldDebug=1&noIntro=1");
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
  await page.waitForTimeout(400);
  await setThird(page, false);
  await pose(page, 0.35, 0.3, -1.76, 0.85, 0.78, 1.25);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/close-nightstand.png` });
  await setThird(page, true);
  await pose(page, 0.0, 0.2, 0.95, 0.8, 0.9);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__world.goTo("computer"));
  for (let i = 0; i < 9; i++) { await page.waitForTimeout(240); await page.screenshot({ path: `${out}/sit-${i}.png` }); }
  await expect(page.locator(".world-panel-bar strong")).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "Back to the room" }).click();
  await expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 15_000 }).toBe("seated");
  await page.waitForTimeout(700);
  await page.keyboard.press("e");
  for (let i = 0; i < 6; i++) { await page.waitForTimeout(240); await page.screenshot({ path: `${out}/rise-${i}.png` }); }
});

test.describe("clips", () => {
  test("chair to board and back, moving in both views", async ({ page }, info) => {
    await open(page, "/night/3d?fixture=1&worldDebug=1&noIntro=1");
    await page.getByRole("button", { name: "Accept" }).click();
    await page.getByRole("button", { name: "End", exact: true }).click();
    await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
    await page.waitForTimeout(400);
    await page.locator("canvas").focus();
    await page.keyboard.down("w"); await page.waitForTimeout(700); await page.keyboard.up("w");
    await page.keyboard.press("v"); await page.waitForTimeout(600);
    await page.keyboard.down("d"); await page.waitForTimeout(600); await page.keyboard.up("d");
    await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(800); await page.keyboard.up("ArrowLeft");
    await page.evaluate(() => window.__world.goTo("computer"));
    await expect(page.locator(".world-panel-bar strong")).toHaveText("Incident board", { timeout: 15_000 });
    await page.waitForTimeout(900);
    await page.getByRole("button", { name: "Back to the room" }).click();
    await expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 8000 }).toBe("seated");
    await page.waitForTimeout(600);
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 8000 }).toBe("walk");
    await page.waitForTimeout(500);
    await page.keyboard.down("s"); await page.waitForTimeout(800); await page.keyboard.up("s");
    await page.waitForTimeout(300);
    await info.attach("video", { path: await page.video()!.path(), contentType: "video/webm" });
  });
});

test.describe("frame times", () => {
  test.skip(!process.env.CAPTURE_PERF, "Run with vsync off.");
  test("steady walk, turning, camera switching, sit to board, meeting", async ({ page }) => {
    const result: Record<string, unknown> = {};
    const mark = async (name: string, act: () => Promise<void>) => {
      await page.evaluate(() => { window.__world.frameTimes.length = 0; });
      await act();
      result[name] = await page.evaluate(() => window.__world.stats());
    };
    const started = Date.now();
    await open(page, "/morning/3d?fixture=1&worldDebug=1&role=author");
    result.loadMs = Date.now() - started - 900;
    result.transfer = await page.evaluate(() => performance.getEntriesByType("resource").filter(e => /\.glb$/.test(e.name)).map(e => [e.name.split("/").pop(), Math.round((e as PerformanceResourceTiming).encodedBodySize / 1024)]));
    await page.evaluate(() => { window.__world.activate("entrance"); window.__world.activate("meeting-door"); window.__world.activate("work-door"); });
    await page.waitForTimeout(700);
    await pose(page, 0, 0.6, 0, 1.5, 8);
    await mark("walk_first", async () => { await page.keyboard.down("w"); await page.waitForTimeout(2500); await page.keyboard.up("w"); });
    await pose(page, 0, 0.6, 0, 1.5, 8);
    await setThird(page, true); await page.waitForTimeout(500);
    await mark("walk_third", async () => { await page.keyboard.down("w"); await page.waitForTimeout(2500); await page.keyboard.up("w"); });
    await mark("turning", async () => { await page.keyboard.down("ArrowLeft"); await page.waitForTimeout(2500); await page.keyboard.up("ArrowLeft"); });
    await mark("camera_switch", async () => { for (let i = 0; i < 10; i++) { await page.keyboard.press("v"); await page.waitForTimeout(180); } });
    await mark("meeting", async () => {
      await page.evaluate(() => window.__world.goTo("meeting-seat"));
      await expect(page.locator(".world-panel-bar strong")).toHaveText("Dana's briefing", { timeout: 15_000 });
      await page.getByRole("button", { name: "Back to the room" }).click();
      await page.waitForTimeout(2500);
    });
    await page.keyboard.press("e");
    await expect.poll(() => page.evaluate(() => window.__world.mode), { timeout: 8000 }).toBe("walk");
    await mark("sit_to_board", async () => {
      await page.evaluate(() => window.__world.goTo("desk-1"));
      await expect(page.locator(".world-panel-bar strong")).toHaveText("Workstation 1", { timeout: 15_000 });
      await page.waitForTimeout(500);
    });
    writeFileSync(`${out}/frame-times.json`, JSON.stringify(result, null, 1));
  });
});
