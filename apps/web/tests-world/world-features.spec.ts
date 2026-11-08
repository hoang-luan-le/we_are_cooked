import { expect, type Page, test } from "@playwright/test";
import { toMinimap } from "../app/world/world-contract";

const evidence = process.env.WORLD_EVIDENCE_DIR ?? "test-results/world";
const shot = (page: Page, name: string) => page.screenshot({ path: `${evidence}/${name}.png` });
type Content = { title: string; lines: string[]; eyebrow: string };
type W = {
  x: number; z: number; y: number; mode: string; rects: unknown[]; requestedZoom: number; firstPerson: boolean; cameraDistance: number;
  lightsOn: Map<string, boolean>; blindsOpen: boolean; displays: Map<string, Content>; character?: { visible: boolean }; characterClip: string;
  camera: { position: { x: number; y: number; z: number } }; activeRects(): { name: string; minX: number; maxX: number; minZ: number; maxZ: number; maxY: number }[];
  activate(id: string): void; goTo(id: string): void; doorIsOpen(id: string): boolean; world(n: string): { x: number; y: number; z: number };
};
declare const window: Window & { __world: W };

const state = (page: Page) => page.evaluate(() => {
  const w = window.__world;
  return { x: w.x, z: w.z, y: w.y, mode: w.mode, zoom: w.requestedZoom, first: w.firstPerson, dist: w.cameraDistance, body: w.character?.visible, clip: w.characterClip, cam: { ...w.camera.position } };
});
async function open(page: Page, url: string) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(url);
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => Boolean(window.__world.character)), { timeout: 15_000 }).toBe(true);
  return errors;
}
async function teleport(page: Page, x: number, z: number, fx: number, fz: number) {
  await page.evaluate(([px, pz, ax, az]) => {
    const w = window.__world as unknown as Record<string, number>;
    const yaw = Math.atan2(-(ax - px), -(az - pz));
    w.x = px; w.z = pz; w.yaw = yaw; w.lookYaw = yaw; w.vx = 0; w.vz = 0; w.pitch = 0; w.lookPitch = 0;
  }, [x, z, fx, fz]);
  await page.locator("canvas").focus();
  await page.waitForTimeout(150);
}
const waitMode = (page: Page, mode: string) => expect.poll(async () => (await state(page)).mode, { timeout: 8000 }).toBe(mode);
const wheelAt = async (page: Page, dy: number, count = 1) => {
  await page.mouse.move(500, 150);
  for (let i = 0; i < count; i++) { await page.mouse.wheel(0, dy); await page.waitForTimeout(40); }
  await page.waitForTimeout(60);
};
const bar = (page: Page) => page.locator(".world-panel-bar strong");
const meeting = (page: Page) => page.locator(".meeting");

async function sitForBriefing(page: Page) {
  await page.evaluate(() => window.__world.goTo("meeting-seat"));
  await expect(bar(page)).toHaveText("Dana's briefing", { timeout: 8000 });
}
const projector = (page: Page) => page.evaluate(() => window.__world.displays.get("Custom_Meeting_Shared_Screen")!);

for (const [scene, url] of [["bedroom", "/night/3d?fixture=1&worldDebug=1&noIntro=1"], ["office", "/morning/3d?fixture=1&worldDebug=1"]] as const) {
  test(`${scene}: scroll camera thresholds, hysteresis and the character`, async ({ page }) => {
    const errors = await open(page, url);
    if (scene === "bedroom") {
      await page.getByRole("button", { name: "Accept" }).click();
      await page.getByRole("button", { name: "End", exact: true }).click();
      await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
      await page.waitForTimeout(200);
    }
    let s = await state(page);
    expect([s.first, s.zoom, s.body]).toEqual([true, 0, false]);
    await wheelAt(page, 100, 2);
    s = await state(page);
    expect(s.first).toBe(true); // 0.70 is inside the dead band: still first person.
    await wheelAt(page, 100, 1);
    s = await state(page);
    expect(s.first).toBe(false);
    await expect.poll(async () => (await state(page)).body).toBe(true);
    if (scene === "office") await shot(page, "third-person-office");
    // Small changes around the dead band never toggle the view.
    expect(s.zoom).toBeCloseTo(2.2, 5); // Crossing the exit jumps to a distance that shows the whole figure.
    await wheelAt(page, -100, 4); // 0.80, inside the dead band, still third person
    for (let i = 0; i < 8; i++) {
      await wheelAt(page, i % 2 ? 20 : -20, 1);
      expect((await state(page)).first).toBe(false);
    }
    await wheelAt(page, -100, 1);
    s = await state(page);
    expect(s.first).toBe(true);
    await expect.poll(async () => (await state(page)).dist).toBeLessThan(0.02);
    await expect.poll(async () => (await state(page)).body).toBe(false);
    // Clamped at both ends.
    await wheelAt(page, -100, 3);
    expect((await state(page)).zoom).toBe(0);
    await wheelAt(page, 100, 14);
    expect((await state(page)).zoom).toBeCloseTo(3.4, 5);
    expect(errors).toEqual([]);
  });
}

test("office: walls and doors shorten the arm without changing the selected view", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  await page.locator("canvas").focus();
  await page.keyboard.press("v");
  await expect.poll(async () => (await state(page)).first).toBe(false);
  const wanted = (await state(page)).zoom;
  // Back against the closed entrance doors, looking away from them.
  await teleport(page, 0, -0.5, 0, -4);
  await teleport(page, 0, 0.6, 0, 4);
  await page.waitForTimeout(400);
  let s = await state(page);
  expect(s.first).toBe(false);
  expect(s.zoom).toBe(wanted);
  expect(s.dist).toBeLessThan(wanted);
  const inside = () => page.evaluate(() => {
    const w = window.__world, p = w.camera.position;
    return w.activeRects().filter(r => p.y < r.maxY && p.x > r.minX && p.x < r.maxX && p.z > r.minZ && p.z < r.maxZ).map(r => r.name);
  });
  expect(await inside()).toEqual([]);
  await shot(page, "third-person-near-wall");
  // Space opens, so the arm eases back to the same choice.
  await teleport(page, 0, 5.5, 0, 9);
  await expect.poll(async () => (await state(page)).dist, { timeout: 4000 }).toBeGreaterThan(wanted - 0.15);
  await page.waitForTimeout(500);
  await shot(page, "third-person-hall");
  // Walking while switching view keeps the same position and keys.
  await page.keyboard.down("w");
  await page.waitForTimeout(250);
  const before = await state(page);
  await page.keyboard.press("v");
  await page.waitForTimeout(120);
  const after = await state(page);
  await page.keyboard.up("w");
  expect(after.first).toBe(true);
  expect(after.z).toBeGreaterThan(before.z);
  expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.7);
  expect(await inside()).toEqual([]);
});

test("the wheel scrolls an open panel and leaves the camera steady, then returns to the world", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 500 });
  await open(page, "/night/3d?fixture=1&worldDebug=1&noIntro=1");
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
  await waitMode(page, "walk");
  await page.evaluate(() => window.__world.goTo("computer"));
  await expect(bar(page)).toHaveText("Incident board", { timeout: 8000 });
  const zoomBefore = (await state(page)).zoom;
  await page.mouse.move(500, 300);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.locator(".world-panel").evaluate(e => e.scrollTop)).toBeGreaterThan(50);
  expect((await state(page)).zoom).toBe(zoomBefore);
  await page.keyboard.press("Escape");
  await waitMode(page, "seated");
  await expect(page.locator("canvas")).toBeFocused();
  await page.keyboard.press("e");
  await waitMode(page, "walk");
  await wheelAt(page, 100, 1);
  expect((await state(page)).zoom).toBeGreaterThan(zoomBefore);
});

test("the character walks, sits and stands in third person", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  await page.evaluate(() => window.__world.activate("entrance"));
  await page.locator("canvas").focus();
  await page.keyboard.press("v");
  await teleport(page, 0, 3, 0, 8);
  await page.keyboard.down("w");
  await expect.poll(async () => (await state(page)).clip).toBe("Walk_Loop");
  await shot(page, "third-person-walking");
  await page.keyboard.up("w");
  await expect.poll(async () => (await state(page)).clip).toBe("Idle_Loop");
  await page.evaluate(() => window.__world.goTo("desk-1"));
  await expect(bar(page)).toHaveText("Workstation 1", { timeout: 8000 });
  expect((await state(page)).clip).toMatch(/^Sitting_/);
  await page.getByRole("button", { name: "Back to the room" }).click();
  await waitMode(page, "seated");
  await page.waitForTimeout(700);
  await shot(page, "third-person-seated");
  await page.keyboard.press("e");
  await waitMode(page, "walk");
  await expect.poll(async () => (await state(page)).clip).toBe("Idle_Loop");
});

test("the view button works without a wheel, in both views the same target is offered", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  await teleport(page, 0, -1.2, 0, 2);
  await expect(page.getByRole("button", { name: /Open entrance doors/ })).toBeVisible();
  await page.getByRole("button", { name: "Switch to third person" }).click();
  await expect(page.getByRole("button", { name: "Switch to first person" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open entrance doors/ })).toBeVisible();
  await page.locator("canvas").focus();
  await page.keyboard.press("e");
  await expect.poll(() => page.evaluate(() => window.__world.activeRects().filter(r => r.name.startsWith("DOOR_office")).length)).toBe(0);
});

test("bedroom objects respond, and a held key activates once", async ({ page }) => {
  await open(page, "/night/3d?fixture=1&worldDebug=1&noIntro=1");
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
  await waitMode(page, "walk");
  await expect(page.getByText("Go to the computer and open the incident board.")).toBeVisible();
  await teleport(page, -0.9, 0.95, -1.78, 1.08);
  await expect(page.getByRole("button", { name: "Bedside lamp" })).toBeVisible();
  await page.evaluate(() => window.__world.activate("lamp"));
  await expect(page.getByText("Lamp off.")).toBeVisible();
  expect(await page.evaluate(() => window.__world.lightsOn.get("bedside"))).toBe(false);
  await shot(page, "bedroom-lamp-off");
  // Held E: the second keydown is a repeat and must not toggle back.
  await page.evaluate(() => window.__world.activate("lamp"));
  await teleport(page, -0.55, 1.4, -0.55, 2.1);
  await expect(page.getByRole("button", { name: "Adjust the blinds" })).toBeVisible();
  await page.keyboard.down("e");
  await page.keyboard.down("e");
  await page.keyboard.up("e");
  expect(await page.evaluate(() => window.__world.blindsOpen)).toBe(false);
  await teleport(page, -0.9, 0.95, -1.52, 0.88);
  await page.evaluate(() => window.__world.activate("clock"));
  await expect(page.getByText("2:04 a.m. The alert fired just now.")).toBeVisible();
});

test("office objects respond, and nothing activates through a wall", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  await page.evaluate(() => window.__world.activate("entrance"));
  await teleport(page, 1.35, 1.9, 1.35, 3.3);
  await expect(page.getByRole("button", { name: "Read the directory" })).toBeVisible();
  await page.keyboard.press("e");
  await expect(page.getByText("Directory: Dana's Meeting Room", { exact: false })).toBeVisible();
  // The teammate is in range through the glass wall, but not reachable from the hallway.
  await teleport(page, -1.6, 11, -2.75, 11.15);
  await expect(page.getByRole("button", { name: "Greet your teammate" })).toHaveCount(0);
  await teleport(page, -3.4, 10.9, -2.75, 11.15);
  await expect(page.getByRole("button", { name: "Greet your teammate" })).toBeVisible();
});

test("meeting: panel, caption and projector stay in sync, and close and reload resume the beat", async ({ page }) => {
  const errors = await open(page, "/morning/3d?fixture=1&worldDebug=1&role=author");
  await expect(page.getByText("Go inside through the entrance doors")).toBeVisible();
  await page.evaluate(() => window.__world.activate("entrance"));
  await expect(page.getByText("Join Dana's briefing in the meeting room")).toBeVisible();
  await sitForBriefing(page);
  await expect(meeting(page).getByText("Fixture · Scripted dialogue")).toBeVisible();
  const titles = ["What happened", "Impact on customers", "What the evidence shows", "What restored checkout", "Known and still uncertain", "Your assignment: Author"];
  for (let i = 0; i < titles.length; i++) {
    await expect(meeting(page).getByRole("heading", { level: 1 })).toHaveText(titles[i]);
    if (i > 0) await expect(meeting(page).getByRole("heading", { level: 1 })).toBeFocused();
    await expect.poll(async () => (await projector(page)).title).toBe(titles[i]);
    const lines = (await projector(page)).lines;
    for (const line of lines) await expect(meeting(page).getByText(line, { exact: true })).toBeVisible();
    await expect(meeting(page).getByLabel("Dana's caption")).toContainText("Dana");
    const text = await meeting(page).innerText();
    expect(text).not.toMatch(/\.get\(|0% loyalty|KeyError.*missing|answer key/i);
    if (i < titles.length - 1) await meeting(page).getByRole("button", { name: "Next", exact: true }).click();
  }
  await meeting(page).getByRole("button", { name: "Back" }).click();
  await meeting(page).getByRole("button", { name: "Back" }).click();
  await expect(meeting(page).getByRole("heading", { level: 1 })).toHaveText(titles[3]);
  // Close and return: same beat, and the projector did not move.
  await page.getByRole("button", { name: "Back to the room" }).click();
  await waitMode(page, "seated");
  await page.waitForTimeout(250);
  await shot(page, "meeting-projector-seated");
  expect((await projector(page)).title).toBe(titles[3]);
  await page.getByRole("button", { name: "Open the panel again" }).click();
  await expect(meeting(page).getByRole("heading", { level: 1 })).toHaveText(titles[3]);
  // Reload resumes the same beat for this run.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await page.evaluate(() => window.__world.goTo("meeting-seat"));
  await expect(bar(page)).toHaveText("Dana's briefing", { timeout: 8000 });
  await expect(meeting(page).getByRole("heading", { level: 1 })).toHaveText(titles[3]);
  await meeting(page).getByRole("button", { name: "Skip to the next objective" }).click();
  await meeting(page).getByRole("button", { name: "Finish the meeting" }).click();
  await waitMode(page, "seated");
  await expect(page.getByText("Go to Workstation 1 for your Author task")).toBeVisible();
  const goal = toMinimap(4.5, 9.2);
  await expect(page.getByTestId("map-goal")).toHaveAttribute("data-u", goal.u.toFixed(1));
  expect(errors).toEqual([]);
});

test("meeting: doorway view of the projector", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1&role=author");
  await page.evaluate(() => { const w = window.__world; w.activate("entrance"); w.activate("meeting-door"); });
  await page.waitForTimeout(500);
  await teleport(page, -2.55, 7.45, -4.5, 11.78);
  await page.waitForTimeout(300);
  await shot(page, "meeting-projector-doorway");
});

for (const [role, desk, other, title, otherPanel] of [
  ["author", "desk-1", "desk-2", "Author task", "Workstation 2"],
  ["reviewer", "desk-2", "desk-1", "Reviewer task", "Workstation 1"],
] as const) {
  test(`${role}: desk shows the assignment, the other desk redirects, and status follows`, async ({ page }) => {
    await open(page, `/morning/3d?fixture=1&worldDebug=1&role=${role}&pr=pending`);
    await page.evaluate(id => window.__world.goTo(id), desk);
    await expect(page.locator(".desk-task").getByRole("heading", { name: title })).toBeVisible({ timeout: 8000 });
    await expect(page.getByText("Fixture assignment")).toBeVisible();
    await expect(page.getByLabel("Pull request status")).toContainText("CI: Pending");
    await expect(page.getByRole("link", { name: "Open pull request on GitHub" })).toBeVisible();
    await page.getByRole("button", { name: "Back to the room" }).click();
    await waitMode(page, "seated");
    const mesh = desk === "desk-1" ? "Custom_WS1_PR_Review_Screen" : "WS2_Laptop_Screen";
    const monitor = await page.evaluate(n => window.__world.displays.get(n)!, mesh);
    expect(monitor.title).toContain(role === "author" ? "Author" : "Reviewer");
    expect(monitor.lines.join()).toContain("CI: Pending");
    await page.waitForTimeout(200);
    await shot(page, `monitor-${role}`);
    await page.keyboard.press("e");
    await waitMode(page, "walk");
    await page.evaluate(id => window.__world.goTo(id), other);
    await expect(bar(page)).toHaveText(otherPanel, { timeout: 8000 });
    await expect(page.getByText("This desk is for your teammate.", { exact: false })).toBeVisible();
  });
}

test("no trusted role gets a neutral objective and monitor", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  await page.evaluate(() => window.__world.activate("entrance"));
  await sitForBriefing(page);
  await meeting(page).getByRole("button", { name: "Skip to the next objective" }).click();
  await expect(meeting(page).getByRole("heading", { level: 1 })).toHaveText("Next: the permanent fix");
  await meeting(page).getByRole("button", { name: "Finish the meeting" }).click();
  await expect(page.locator(".world-objective")).toHaveText("Go to a workstation and open the Morning workspace");
  expect(await page.evaluate(() => window.__world.displays.get("Custom_WS1_PR_Review_Screen")!.lines[0])).toContain("Waiting");
});

test("missing evidence and handoff stay honest, and the meeting still finishes", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1&role=author&evidence=missing&handoff=missing");
  await page.evaluate(() => window.__world.activate("entrance"));
  await sitForBriefing(page);
  await expect(meeting(page).getByText("The Night handoff has not been written yet.")).toBeVisible();
  await meeting(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect(meeting(page).getByText("Not reviewed overnight.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await projector(page)).lines.join()).toContain("Not reviewed overnight.");
  await meeting(page).getByRole("button", { name: "Skip to the next objective" }).click();
  await meeting(page).getByRole("button", { name: "Finish the meeting" }).click();
  await expect(page.getByText("Go to Workstation 1 for your Author task")).toBeVisible();
});

for (const [pr, expected] of [["failed", "CI: Failed"], ["verified", "CI: Passing"]] as const) {
  test(`desk status: ${pr}`, async ({ page }) => {
    await open(page, `/morning/3d?fixture=1&worldDebug=1&role=author&pr=${pr}`);
    await page.evaluate(() => window.__world.goTo("desk-1"));
    await expect(page.getByLabel("Pull request status")).toContainText(expected, { timeout: 8000 });
  });
}

test("2D fallback carries the meeting and the desk task", async ({ page }) => {
  await page.goto("/morning/3d?fixture=1&role=reviewer&no3d=1");
  await expect(page.locator("canvas")).toHaveCount(0);
  await expect(page.locator(".world-still img")).toBeVisible();
  await expect(meeting(page).getByRole("heading", { level: 1 })).toHaveText("What happened");
  await meeting(page).getByRole("button", { name: "Skip to the next objective" }).click();
  await expect(meeting(page).getByRole("heading", { level: 1 })).toHaveText("Your assignment: Reviewer");
  await expect(page.locator(".desk-task").getByRole("heading", { name: "Reviewer task" })).toBeVisible();
});

test("reduced motion reaches the same state with no wake-up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/night/3d?fixture=1&worldDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await page.getByRole("button", { name: "Accept" }).click();
  await page.getByRole("button", { name: "End", exact: true }).click();
  await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
  await waitMode(page, "walk");
  await page.evaluate(() => window.__world.goTo("computer"));
  await expect(bar(page)).toHaveText("Incident board", { timeout: 8000 });
  await expect(page.getByRole("button", { name: "Back to the room" })).toBeFocused();
});

for (const [name, url, target, title, seatAnchor] of [
  ["bedroom desk", "/night/3d?fixture=1&worldDebug=1&noIntro=1", "computer", "Incident board", "chair_bedroom_desk_seat_anchor"],
  ["workstation 1", "/morning/3d?fixture=1&worldDebug=1&role=author", "desk-1", "Workstation 1", "chair_office_ws1_seat_anchor"],
  ["workstation 2", "/morning/3d?fixture=1&worldDebug=1&role=reviewer", "desk-2", "Workstation 2", "chair_office_ws2_seat_anchor"],
] as const) {
  test(`chair sequence: ${name} walks in, sits, goes to the monitor, returns, stands`, async ({ page }) => {
    await open(page, url);
    if (target === "computer") {
      await page.getByRole("button", { name: "Accept" }).click();
      await page.getByRole("button", { name: "End", exact: true }).click();
      await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
      await waitMode(page, "walk");
    }
    const samples: { y: number; clip: string }[] = [];
    await page.evaluate(id => window.__world.goTo(id), target);
    const end = Date.now() + 7000;
    while (Date.now() < end && !(await bar(page).isVisible())) {
      const s = await state(page);
      samples.push({ y: s.y, clip: s.clip });
      await page.waitForTimeout(40);
    }
    await expect(bar(page)).toHaveText(title);
    const seat = await page.evaluate(n => window.__world.world(n), seatAnchor);
    // Intermediate heights prove a physical lowering, not a jump.
    expect(samples.filter(s => s.y < 1.58 && s.y > seat.y + 0.03).length).toBeGreaterThan(2);
    expect(samples.some(s => s.clip.startsWith("Sitting"))).toBe(true);
    await expect(page.getByRole("button", { name: "Back to the room" })).toBeFocused();
    let s = await state(page);
    expect(Math.hypot(s.x - seat.x, s.z - seat.z)).toBeLessThan(0.01);
    await page.getByRole("button", { name: "Back to the room" }).click();
    await waitMode(page, "seated");
    await expect(page.locator("canvas")).toBeFocused();
    s = await state(page);
    expect(Math.abs(s.y - seat.y)).toBeLessThan(0.01);
    await page.keyboard.press("e");
    await waitMode(page, "walk");
    expect((await state(page)).y).toBeCloseTo(1.6, 3);
  });
}

test("input during a transition is ignored and a closing door will not trap the player", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1&role=author");
  await page.evaluate(() => window.__world.goTo("desk-1"));
  await page.waitForTimeout(250);
  for (let i = 0; i < 5; i++) { await page.keyboard.press("e"); await page.keyboard.press("v"); }
  await expect(bar(page)).toHaveText("Workstation 1", { timeout: 8000 });
  await page.getByRole("button", { name: "Back to the room" }).click();
  await waitMode(page, "seated");
  await page.keyboard.press("e");
  await waitMode(page, "walk");
  await page.waitForTimeout(500);
  await teleport(page, -0.6, 0, -0.6, 2);
  await page.evaluate(() => window.__world.activate("entrance"));
  await expect(page.getByText("You're standing in the doorway.")).toBeVisible();
  expect(await page.evaluate(() => window.__world.doorIsOpen("office_entrance_left"))).toBe(true);
});

test("coworkers present: Dana talks in the meeting, turns to the screen, the teammate leaves after", async ({ page }) => {
  await open(page, "/morning/3d?fixture=1&worldDebug=1&role=author");
  await page.evaluate(() => window.__world.activate("entrance"));
  await expect.poll(() => page.evaluate(() => (window.__world as unknown as { npcs: Map<string, unknown> }).npcs.size), { timeout: 20_000 }).toBe(2);
  const npc = (id: string) => page.evaluate(n => { const c = (window.__world as unknown as { npcs: Map<string, { clip: string; face: number; root: { position: { x: number; z: number } } }> }).npcs.get(n)!; return { clip: c.clip, face: c.face, x: c.root.position.x, z: c.root.position.z }; }, id);
  expect((await npc("dana")).clip).toBe("Idle_Loop");
  await sitForBriefing(page);
  await expect.poll(async () => (await npc("dana")).clip).toBe("Idle_Talking_Loop");
  const faceA = (await npc("dana")).face;
  await meeting(page).getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(async () => (await npc("dana")).face).not.toBe(faceA);
  await meeting(page).getByRole("button", { name: "Skip to the next objective" }).click();
  await meeting(page).getByRole("button", { name: "Finish the meeting" }).click();
  const start = await npc("teammate");
  await expect.poll(async () => (await npc("teammate")).clip, { timeout: 6000 }).toBe("Walk_Loop");
  await expect.poll(async () => (await npc("teammate")).x, { timeout: 15_000 }).toBeGreaterThan(start.x + 1);
});

test("leaving during load and moving between Night and Morning stay clean", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto("/night/3d?fixture=1&worldDebug=1");
  await page.goto("/morning/3d?fixture=1&worldDebug=1");
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await page.goto("/night/3d?fixture=1&worldDebug=1&noIntro=1");
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  await page.goBack();
  await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  expect(errors).toEqual([]);
});

for (const [scene, url, id, chair] of [
  ["bedroom desk", "/night/3d?fixture=1&worldDebug=1&noIntro=1", "computer", "Chair_Bedroom_Desk"],
  ["meeting room", "/morning/3d?fixture=1&worldDebug=1", "meeting-seat", "Chair_Meeting_1"],
  ["workstation 1", "/morning/3d?fixture=1&worldDebug=1", "desk-1", "Chair_WS1"],
  ["workstation 2", "/morning/3d?fixture=1&worldDebug=1", "desk-2", "Chair_WS2"],
] as const) {
  test(`seated hips land on the chair: ${scene}`, async ({ page }) => {
    await page.goto(url);
    await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { __world?: { rects?: unknown[] } }).__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
    if (id === "computer") {
      await page.getByRole("button", { name: "Accept" }).click();
      await page.getByRole("button", { name: "End", exact: true }).click();
      await page.evaluate(async () => { const w = (window as unknown as { __world: { callPhase: string; mode: string; standUp(): void } }).__world; while (w.callPhase !== "idle" || w.mode !== "seated") await new Promise(r => setTimeout(r, 40)); w.standUp(); while ((w.mode as string) !== "walk") await new Promise(r => setTimeout(r, 40)); });
    }
    await page.evaluate(target => (window as unknown as { __world: { goTo(i: string): void } }).__world.goTo(target), id);
    await expect(page.locator(".world-panel-bar strong")).toBeVisible({ timeout: 25_000 });
    await page.getByRole("button", { name: "Back to the room" }).click();
    await page.waitForTimeout(1200);
    const gap = await page.evaluate(name => {
      type N = { name: string; updateWorldMatrix(a: boolean, b: boolean): void; matrixWorld: { elements: number[] }; getObjectByName(n: string): N };
      const w = (window as unknown as { __world: { scene: N; body: { root: N } } }).__world;
      const at = (n: N) => { n.updateWorldMatrix(true, false); const e = n.matrixWorld.elements; return [e[12], e[13], e[14]]; };
      const hips = at(w.body.root.getObjectByName("Bip01_Pelvis")), seat = at(w.scene.getObjectByName(name));
      return { across: Math.hypot(hips[0] - seat[0], hips[2] - seat[2]), height: hips[1] };
    }, chair);
    expect(gap.across).toBeLessThan(0.16);   // Inside the 0.48 m seat.
    expect(gap.height).toBeGreaterThan(0.47);  // Hips above the 0.455 m cushion.
    expect(gap.height).toBeLessThan(0.6);
  });
}

test("reopening releases the WebGL context", async ({ page }) => {
  const warnings: string[] = [];
  page.on("console", m => { if (/too many active webgl/i.test(m.text())) warnings.push(m.text()); });
  await open(page, "/morning/3d?fixture=1&worldDebug=1");
  for (let i = 0; i < 25; i++) {
    await page.getByRole("button", { name: "Use 2D view" }).click();
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.evaluate(() => { (window as unknown as { __world?: unknown }).__world = undefined; });
    await page.getByRole("button", { name: "Return to 3D" }).click();
    await expect.poll(() => page.evaluate(() => Boolean(window.__world?.rects?.length)), { timeout: 30_000 }).toBe(true);
  }
  expect(warnings).toEqual([]);
});
