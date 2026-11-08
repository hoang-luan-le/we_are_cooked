import { writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";

// Measures movement and camera steadiness on the Morning route with real key input. Skipped unless requested.
const label = process.env.MOVE_LABEL;
test.skip(!label, "Set MOVE_LABEL to measure.");
type W = Record<string, unknown> & { rects: unknown[]; activate(id: string): void; toggleView(): void; firstPerson: boolean; camera: { position: { x: number; y: number; z: number } } };
declare const window: Window & { __world: W; __samples?: number[][] };
const place = (page: Page, x: number, z: number, yaw: number) => page.evaluate(([a, b, c]) => { Object.assign(window.__world, { x: a, z: b, yaw: c, lookYaw: c, pitch: -0.05, lookPitch: -0.05, vx: 0, vz: 0 }); }, [x, z, yaw]);
const start = (page: Page) => page.evaluate(() => {
  window.__samples = [];
  let prev = performance.now();
  const tick = (now: number) => {
    if (!window.__samples) return;
    const c = window.__world.camera.position, w = window.__world as unknown as { x: number; z: number };
    window.__samples.push([now - prev, c.x, c.y, c.z, w.x, w.z]);
    prev = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const stop = async (page: Page) => {
  const rows = await page.evaluate(() => { const r = window.__samples!; window.__samples = undefined; return r; });
  const stepsCam: number[] = [], stepsBody: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    stepsCam.push(Math.hypot(rows[i][1] - rows[i - 1][1], rows[i][2] - rows[i - 1][2], rows[i][3] - rows[i - 1][3]) / (rows[i][0] / 1000));
    stepsBody.push(Math.hypot(rows[i][4] - rows[i - 1][4], rows[i][5] - rows[i - 1][5]) / (rows[i][0] / 1000));
  }
  const jerk = (a: number[]) => { const d = a.slice(1).map((v, i) => Math.abs(v - a[i])).sort((x, y) => x - y); return { p50: +d[Math.floor(d.length * .5)].toFixed(3), p99: +d[Math.floor(d.length * .99)].toFixed(3), max: +d[d.length - 1].toFixed(3) }; };
  return { frames: rows.length, camSpeedJump: jerk(stepsCam), bodySpeedJump: jerk(stepsBody) };
};
test("Morning steadiness", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/morning/3d?fixture=1&worldDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => { for (const id of ["entrance", "meeting-door", "work-door"]) window.__world.activate(id); });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__world.toggleView());
  await page.locator("canvas").focus();
  const out: Record<string, unknown> = {};
  const run = async (name: string, x: number, z: number, yaw: number, keys: string[], ms: number) => {
    await place(page, x, z, yaw);
    await page.waitForTimeout(700);
    await start(page);
    for (const key of keys) await page.keyboard.down(key);
    await page.waitForTimeout(ms);
    for (const key of keys) await page.keyboard.up(key);
    await page.waitForTimeout(350);
    out[name] = await stop(page);
  };
  await run("through_entrance", 0.2, -3.2, Math.PI, ["w"], 3800);
  await run("graze_hall_wall", 1.5, 1, Math.PI, ["w", "d"], 3200);
  await run("reception_corner", -1.6, 0.6, Math.PI, ["w", "a"], 3000);
  await run("meeting_table", -3.2, 7.4, Math.PI + 0.5, ["w"], 2600);
  await run("desk_bay", 3.2, 7.3, Math.PI - 0.5, ["w"], 2600);
  writeFileSync(`${process.env.WORLD_EVIDENCE_DIR}/move-${label}.json`, JSON.stringify(out, null, 1));
});
