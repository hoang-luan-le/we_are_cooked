import { mkdirSync, writeFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { isFree, reachable, type Rect } from "../app/world/collision";
import { toMinimap } from "../app/world/world-contract";

const evidence = process.env.WORLD_EVIDENCE_DIR ?? "test-results/world";
mkdirSync(evidence, { recursive: true });
const record = (name: string, data: unknown) => writeFileSync(`${evidence}/${name}.json`, JSON.stringify(data, null, 1));
const shot = (page: Page, name: string) => page.screenshot({ path: `${evidence}/${name}.png` });
const R = 0.32;

type Stats = { frames: number; medianMs: number; p95Ms: number; p99Ms: number; calls: number; triangles: number; gpu: string };
type World = {
  x: number; z: number; y: number; yaw: number; mode: string; frameTimes: number[]; rects: Rect[];
  activeRects(): Rect[]; goTo(id: string): void; activate(id: string): void; standUp(): void; doorIsOpen(id: string): boolean; stats(): Stats;
  world(name: string): { x: number; y: number; z: number };
};
declare const window: Window & { __world: World };

const pose = (page: Page) => page.evaluate(() => ({ x: window.__world.x, y: window.__world.y, z: window.__world.z, yaw: window.__world.yaw, mode: window.__world.mode }));
const node = (page: Page, name: string) => page.evaluate(n => window.__world.world(n), name);
const waitMode = (page: Page, mode: string) => expect.poll(async () => (await pose(page)).mode, { timeout: 8000 }).toBe(mode);

async function open(page: Page, url: string) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(`${message.text()} ${message.location().url}`); });
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await expect(page.getByText("Loading the 3D scene…")).toHaveCount(0);
  return errors;
}

async function hold(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

async function teleport(page: Page, x: number, z: number, faceX: number, faceZ: number) {
  await page.evaluate(([px, pz, fx, fz]) => {
    const w = window.__world as unknown as Record<string, number>;
    const yaw = Math.atan2(-(fx - px), -(fz - pz));
    w.x = px; w.z = pz; w.yaw = yaw; w.lookYaw = yaw; w.vx = 0; w.vz = 0; w.pitch = 0; w.lookPitch = 0;
  }, [x, z, faceX, faceZ]);
  await page.locator("canvas").focus();
  await page.waitForTimeout(160);
}

async function sitCycle(page: Page, approach: string, seat: string, stand: string, target: string, panelTitle: string) {
  const a = await node(page, approach);
  await page.evaluate(() => undefined);
  await teleport(page, a.x, a.z, a.x, a.z + 1);
  await expect(page.getByRole("button", { name: new RegExp(panelTitle.includes("briefing") ? "Sit for the briefing" : "Sit at") }).first()).toBeVisible();
  await page.evaluate(id => window.__world.activate(id), target);
  await expect(page.getByRole("button", { name: "Back to the room" })).toBeFocused({ timeout: 8000 });
  await expect(page.locator(".world-panel-bar strong")).toHaveText(panelTitle);
  const s = await node(page, seat);
  const seated = await pose(page);
  expect(Math.hypot(seated.x - s.x, seated.z - s.z)).toBeLessThan(0.01);
  expect(Math.abs(seated.y - s.y)).toBeLessThan(0.01);
  await shot(page, `panel-${target}`);
  await page.getByRole("button", { name: "Back to the room" }).click();
  await waitMode(page, "seated");
  await expect(page.locator("canvas")).toBeFocused();
  await page.waitForTimeout(100);
  await shot(page, `seated-${target}`);
  await page.keyboard.press("e");
  await waitMode(page, "walk");
  const st = await node(page, stand);
  const stood = await pose(page);
  expect(Math.hypot(stood.x - st.x, stood.z - st.z)).toBeLessThan(0.01);
  const free = await page.evaluate(() => window.__world.activeRects());
  expect(isFree(stood.x, stood.z, R, free)).toBe(true);
  return stood;
}

test("bedroom: call controls first, then the computer opens the same incident board", async ({ page }) => {
  const errors = await open(page, "/night/3d?fixture=1&worldDebug=1");
  await expect(page.getByRole("button", { name: "Answer Dana" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Snooze" })).toBeEnabled();
  await expect(page.getByText("02:04", { exact: false }).first()).toBeVisible();
  expect((await pose(page)).mode).toBe("fixed");
  await page.waitForTimeout(800);
  await shot(page, "bedroom-spawn-call");
  await page.getByRole("button", { name: "Snooze" }).click();
  await expect(page.getByText("Page snoozed", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Answer Dana" }).click();
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeFocused();
  await page.getByRole("textbox", { name: "Message Dana" }).fill("What changed?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log", { name: "Dana captions" })).toContainText("A release went out at 01:47");
  await shot(page, "bedroom-briefing-captions");
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await waitMode(page, "walk");
  await expect(page.locator(".world-panel")).toBeHidden();
  await expect(page.locator("canvas")).toBeFocused();

  // Phone and screen targeting.
  const [screen, surface] = await Promise.all([node(page, "bedroom_screen_plane"), node(page, "Custom_Monitor_Display_Surface")]);
  expect(Math.hypot(screen.x - surface.x, screen.y - surface.y, screen.z - surface.z)).toBeLessThan(0.002);

  // Bed and wall stop the player.
  await page.locator("canvas").focus();
  await teleport(page, -0.3, -0.7, -3, -0.7);
  await hold(page, "w", 900);
  expect((await pose(page)).x).toBeGreaterThanOrEqual(-0.826 + R - 0.02);

  await sitCycle(page, "chair_bedroom_desk_approach", "chair_bedroom_desk_seat_anchor", "chair_bedroom_desk_stand_anchor", "computer", "Incident board");
  await sitCycle(page, "chair_bedroom_desk_approach", "chair_bedroom_desk_seat_anchor", "chair_bedroom_desk_stand_anchor", "computer", "Incident board");

  await teleport(page, 0.95, -0.42, 0.95, -1.48);
  await page.evaluate(() => window.__world.activate("computer"));
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible({ timeout: 8000 });
  const rollback = page.getByRole("button", { name: "Roll back to v2.13.9" });
  await rollback.click();
  await page.getByRole("dialog").getByRole("button", { name: "Confirm rollback" }).click();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible({ timeout: 12_000 });
  await shot(page, "bedroom-board-recovered");
  await page.keyboard.press("Escape");
  await waitMode(page, "seated");
  await page.getByRole("button", { name: "Open the panel again" }).click();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("office: collision, doors, minimap, briefing, and both desks", async ({ page }) => {
  const errors = await open(page, "/morning/3d?fixture=1&worldDebug=1");
  await page.waitForTimeout(800);
  await shot(page, "office-spawn");
  const start = await pose(page);
  const spawn = await node(page, "office_exterior_spawn");
  expect([start.x, start.z]).toEqual([spawn.x, spawn.z]);

  // Static route check with doors open and with them closed.
  const open3 = await page.evaluate(() => window.__world.rects);
  const closed = await page.evaluate(() => window.__world.activeRects());
  const points = await Promise.all(["chair_meeting_seat_1_approach", "chair_office_ws1_approach", "chair_office_ws2_approach", "chair_meeting_seat_1_stand_anchor", "chair_office_ws1_stand_anchor", "chair_office_ws2_stand_anchor"].map(n => node(page, n)));
  const route: Record<string, boolean> = {};
  points.forEach((p, i) => {
    route[`free_${i}`] = isFree(p.x, p.z, R, open3);
    route[`reach_doors_open_${i}`] = reachable([spawn.x, spawn.z], [p.x, p.z], R, open3);
    route[`reach_doors_closed_${i}`] = reachable([spawn.x, spawn.z], [p.x, p.z], R, closed);
  });
  record("office-route", route);
  for (const [key, value] of Object.entries(route)) expect(value, key).toBe(!key.includes("closed"));

  // Closed entrance blocks, E opens it, the leaf collider clears.
  await teleport(page, 0, -1.2, 0, 2);
  await hold(page, "w", 1300);
  let now = await pose(page);
  expect(now.z).toBeLessThan(-0.3);
  await shot(page, "office-closed-door-stop");
  await expect(page.getByRole("button", { name: /Open entrance doors/ })).toBeVisible();
  await page.keyboard.press("e");
  await expect.poll(() => page.evaluate(() => window.__world.activeRects().filter(r => r.name.startsWith("DOOR_office")).length)).toBe(0);
  await page.waitForTimeout(300);
  await shot(page, "office-entrance-open");
  await hold(page, "w", 1400);
  now = await pose(page);
  expect(now.z).toBeGreaterThan(0.5);

  // Minimap: position on Argon's transform, four headings.
  const player = page.getByTestId("map-player");
  for (const [fx, fz, heading] of [[0, 1, 0], [-1, 0, 90], [0, -1, 180], [1, 0, -90]] as const) {
    await teleport(page, 0, 5.8, fx, 5.8 + fz);
    await page.evaluate(([x, z]) => {
      const w = window.__world as unknown as Record<string, number>;
      const yaw = Math.atan2(-x, -z); w.yaw = yaw; w.lookYaw = yaw;
    }, [fx, fz]);
    await page.waitForTimeout(200);
    const reported = Number(await player.getAttribute("data-heading"));
    expect(Math.abs(((reported - heading + 540) % 360) - 180)).toBeLessThan(2);
  }
  const expected = toMinimap(0, 5.8);
  expect(Number(await player.getAttribute("data-u"))).toBeCloseTo(expected.u, 0);
  expect(Number(await player.getAttribute("data-v"))).toBeCloseTo(expected.v, 0);
  await shot(page, "office-minimap-hall");

  // Meeting door, then the briefing seat.
  await teleport(page, -1.0, 7.43, -3, 7.43);
  await hold(page, "w", 700);
  expect((await pose(page)).x).toBeGreaterThan(-1.72);
  await page.keyboard.press("e");
  await expect.poll(() => page.evaluate(() => window.__world.doorIsOpen("meeting_room"))).toBe(true);
  await page.waitForTimeout(500);
  await hold(page, "w", 1100);
  expect((await pose(page)).x).toBeLessThan(-2.3);
  await sitCycle(page, "chair_meeting_seat_1_approach", "chair_meeting_seat_1_seat_anchor", "chair_meeting_seat_1_stand_anchor", "meeting-seat", "Dana's briefing");
  await teleport(page, -5.2, 10.75, -6.15, 11.15);
  await expect(page.getByRole("button", { name: /Join Dana's briefing/ })).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.locator(".world-panel-bar strong")).toHaveText("Dana's briefing");
  await page.keyboard.press("Tab");
  await page.getByRole("button", { name: "Back to the room" }).press("Escape");
  await waitMode(page, "walk");

  for (const [desk, chair, title] of [["desk-1", "chair_office_ws1", "Workstation 1"], ["desk-2", "chair_office_ws2", "Workstation 2"]] as const) {
    const stand1 = await sitCycle(page, `${chair}_approach`, `${chair}_seat_anchor`, `${chair}_stand_anchor`, desk, title);
    await sitCycle(page, `${chair}_approach`, `${chair}_seat_anchor`, `${chair}_stand_anchor`, desk, title);
    expect(stand1.mode).toBe("walk");
  }

  // Go-to path for keyboard and touch users.
  await page.locator("canvas").focus();
  await page.getByText("Go to without walking").click();
  await page.locator(".world-goto").getByRole("button", { name: "Sit at workstation 1" }).click();
  await expect(page.locator(".world-panel-bar strong")).toHaveText("Workstation 1", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to the room" }).click();
  await waitMode(page, "seated");
  await page.keyboard.press("e");
  await waitMode(page, "walk");

  // Input is released when the window loses focus.
  await page.keyboard.down("w");
  await page.waitForTimeout(150);
  await page.evaluate(() => globalThis.dispatchEvent(new Event("blur")));
  const a = await pose(page);
  await page.waitForTimeout(350);
  const b = await pose(page);
  await page.keyboard.up("w");
  expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.03);
  expect(errors).toEqual([]);
});

test("pointer lock, keyboard focus, and E on the phone", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  const locked = () => page.evaluate(() => document.pointerLockElement?.tagName ?? null);
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(locked).toBe("CANVAS");
  const before = (await pose(page)).yaw;
  await page.mouse.move(900, 320);
  await page.waitForTimeout(200);
  expect(Math.abs((await pose(page)).yaw - before)).toBeGreaterThan(0.02);
  // Keys keep working under lock, and leaving lock clears held keys.
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  await page.evaluate(() => document.exitPointerLock());
  await expect.poll(locked).toBe(null);
  const a = await pose(page);
  await page.waitForTimeout(300);
  const b = await pose(page);
  await page.keyboard.up("w");
  expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.03);
  // Sitting releases the mouse, and leaving returns focus to the scene.
  await page.mouse.move(800, 300);
  await page.mouse.down();
  await page.mouse.up();
  await expect.poll(locked).toBe("CANVAS");
  const ws = await node(page, "chair_office_ws1_approach");
  await teleport(page, ws.x, ws.z, ws.x, ws.z + 1);
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Back to the room" })).toBeFocused({ timeout: 8000 });
  expect(await locked()).toBe(null);

  await page.goto("/night/3d?fixture=1&worldDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await expect(page.locator("canvas")).toBeFocused();
  await page.keyboard.press("e");
  await expect(page.getByRole("button", { name: "Answer Dana" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeFocused();
});

test("frame times and transfer on the walking route", async ({ page }) => {
  const results: Record<string, unknown> = {};
  for (const [scene, url, routeSteps] of [
    ["bedroom", "/night/3d?fixture=1&worldDebug=1", 0],
    ["office", "/morning/3d?fixture=1&worldDebug=1", 1],
  ] as const) {
    const started = Date.now();
    await open(page, url);
    const loadMs = Date.now() - started;
    if (routeSteps) {
      await teleport(page, 0, -3.5, 0, 6);
      await page.keyboard.press("Tab");
      await page.locator("canvas").focus();
      await page.evaluate(() => { const w = window.__world; w.activate("entrance"); });
      await page.waitForTimeout(600);
      await teleport(page, 0, -2.8, 0, 6);
    }
    await page.waitForTimeout(200);
    const viewAtStart = await page.evaluate(() => { const s = window.__world.stats(); return { calls: s.calls, triangles: s.triangles }; });
    await page.evaluate(() => { window.__world.frameTimes.length = 0; });
    if (routeSteps) await hold(page, "w", 6000);
    else await page.waitForTimeout(6000);
    const transfer = await page.evaluate(() => performance.getEntriesByType("resource")
      .filter(e => e.name.endsWith(".glb")).map(e => ({ name: e.name, kB: Math.round((e as PerformanceResourceTiming).encodedBodySize / 1024), ms: Math.round(e.duration) })));
    results[scene] = { loadMs, transfer, viewAtStart, viewport: page.viewportSize(), ...(await page.evaluate(() => window.__world.stats())) };
  }
  record("frame-times", results);
  console.log(JSON.stringify(results));
});

test.describe("fallbacks", () => {
  test("no3d shows the still and the same 2D flow, including rollback", async ({ page }) => {
    await page.goto("/night/3d?fixture=1&no3d=1");
    await expect(page.locator(".world-still img")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.getByRole("button", { name: "Answer Dana" }).click();
    await page.getByRole("button", { name: "Continue to dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeFocused();
    await page.getByRole("button", { name: "Roll back to v2.13.9" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm rollback" }).click();
    await expect(page.getByText("Recovered", { exact: true })).toBeVisible({ timeout: 12_000 });
    await shot(page, "fallback-2d-recovered");
  });

  test("a browser without WebGL lands in the 2D flow", async ({ page }) => {
    await page.addInitScript(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });
    await page.goto("/night/3d?fixture=1");
    await expect(page.getByText("This browser cannot show the 3D scene.", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Answer Dana" })).toBeEnabled();
  });

  test("the in-scene 2D switch keeps progress", async ({ page }) => {
    await open(page, "/night/3d?fixture=1&worldDebug=1");
    await page.getByRole("button", { name: "Answer Dana" }).click();
    await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeFocused();
    await page.getByRole("button", { name: "Use 2D view" }).click();
    await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeVisible();
    await page.getByRole("button", { name: "Return to 3D" }).click();
    await expect(page.locator("canvas")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeVisible();
  });
});

test.describe("reduced motion and small screens", () => {
  test.use({ reducedMotion: "reduce", viewport: { width: 390, height: 844 }, hasTouch: true });
  test("doors and seats are immediate, and call controls fit", async ({ page }) => {
    await open(page, "/morning/3d?fixture=1&worldDebug=1");
    await teleport(page, 0, -1.2, 0, 2);
    await page.keyboard.press("e");
    expect(await page.evaluate(() => window.__world.activeRects().filter(r => r.name.startsWith("DOOR_office")).length)).toBe(0);
    await shot(page, "office-mobile");
    await open(page, "/night/3d?fixture=1&worldDebug=1");
    await page.waitForTimeout(400);
    const answer = page.getByRole("button", { name: "Answer Dana" });
    await expect(answer).toBeInViewport();
    await shot(page, "bedroom-mobile");
  });
});
