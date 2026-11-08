import { expect, test } from "@playwright/test";
import type { ActionRequest, IncidentState } from "../../../packages/contracts/types";

const api = process.env.NIGHT_TEST_API_ORIGIN;
const peer = process.env.NIGHT_TEST_PEER_ORIGIN;

test("two demo members share evidence, preserve a draft, and count one real Help call", async ({ page, browser, request }) => {
  test.skip(!api || !peer || process.env.NIGHT_TEST_TEAM_ENTRY !== "1", "Run the team backend and two local web identities.");
  test.setTimeout(45_000);
  const created = await request.post(`${api}/api/incident/start`, {
    headers: { "X-Demo-User": "demo-a" }, data: { level: "explore", teammates: ["demo-b"] },
  });
  expect(created.status()).toBe(201);
  const incident: IncidentState = await created.json();
  const id = incident.incident_id;
  const path = `/night?incident=${id}`;
  const state = async (): Promise<IncidentState> => (await request.get(`${api}/api/incident/${id}`)).json();
  const helpConnections: string[] = [];
  page.on("websocket", socket => {
    if (new URL(socket.url()).searchParams.get("call") === "help") helpConnections.push(socket.url());
  });

  await page.goto(path);
  await page.getByRole("button", { name: "Snooze" }).click();
  await expect(page.getByText("Page snoozed.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Page snoozed.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Answer Dana by text" }).click();
  await expect(page.getByText(/Dana relay · text · Scripted/)).toBeVisible();
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
  await page.getByRole("button", { name: "Open checkout logs" }).click();
  await expect(page.getByText("The team API has not supplied role-specific log entries.")).toBeVisible();

  const otherContext = await browser.newContext();
  try {
    const other = await otherContext.newPage();
    await other.goto(`${peer}${path}`);
    const draft = other.getByRole("textbox", { name: "Status update" });
    await draft.fill("Investigating the checkout regression.");
    await expect(draft).toBeFocused();

    const keys: string[] = [];
    await page.route("**/api/night?incident=*", async route => {
      const body: ActionRequest | null = route.request().postDataJSON();
      if (body?.action !== "share_finding") return route.continue();
      keys.push(body.idempotency_key);
      if (keys.length !== 1) return route.continue();
      const accepted = await route.fetch();
      expect(accepted.ok()).toBe(true);
      await route.abort("failed");
    });
    const text = "Guest checkout errors began after the release.";
    await page.getByRole("textbox", { name: "Finding" }).fill(text);
    await page.getByRole("button", { name: "Pin finding" }).click();
    await expect(page.getByText("The API did not confirm this note.", { exact: false })).toBeVisible();
    await expect(other.getByRole("listitem").filter({ hasText: text })).toHaveClass("new-evidence");
    await expect(draft).toHaveValue("Investigating the checkout regression.");
    await expect(draft).toBeFocused();

    await page.getByRole("button", { name: "Pin finding" }).click();
    await expect(page.getByRole("textbox", { name: "Finding" })).toHaveValue("");
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect((await state()).findings).toEqual([expect.objectContaining({ by: "demo-a", text })]);
    await other.getByRole("button", { name: "Send status update" }).click();
    await expect(page.getByText("Investigating the checkout regression.", { exact: true })).toBeVisible();
    expect((await state()).status_updates).toEqual([expect.objectContaining({ by: "demo-b" })]);

    await expect(page.getByRole("button", { name: "Open Dana debrief by text" })).toHaveCount(0);
    await page.getByRole("button", { name: "Ask Dana for help by text" }).click();
    await expect(page.getByRole("heading", { name: "Dana help" })).toBeFocused();
    await expect(page.getByText(/Dana relay · text · Scripted/)).toBeVisible();
    expect(helpConnections).toHaveLength(1);
    expect(new URL(helpConnections[0]).searchParams.get("incident_id")).toBe(id);
    await expect.poll(async () => (await state()).hint_calls).toBe(1);
    await page.getByRole("textbox", { name: "Message Dana" }).fill("I checked the errors.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Dana help" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeFocused();
    await page.getByText("Last Dana help transcript").click();
    await expect(page.getByText("I checked the errors.", { exact: false })).toBeVisible();
    expect((await state()).hint_calls).toBe(1);
    expect((await state()).actions_taken).not.toContain("call_dana");

    await other.getByRole("button", { name: "Roll back to v2.13.9" }).click();
    await other.getByRole("button", { name: "Confirm rollback" }).click();
    await expect(other.getByText("Recovered", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Recovered", { exact: true })).toBeVisible({ timeout: 15_000 });
    expect((await state()).actions_taken.filter(action => action === "rollback")).toHaveLength(1);
  } finally {
    await otherContext.close();
  }
});

test("shows the stakeholder ring only between calls and waits for a confirmed fix for debrief", async ({ page }) => {
  test.skip(!api, "Enable the local API configuration for the Night board.");
  let phase: IncidentState["phase"] = "investigating";
  let nudge = true;
  const calls: string[] = [];
  await page.route("**/api/night", route => route.fulfill({ json: {
    incident_id: "inc_demo", level: "explore", phase, status: phase === "fixed" ? "fixed" : phase === "stabilized" ? "rolled_back" : "broken",
    sim_clock: "02:09", metrics: { error_rate: 5, orders_per_min: 380, p95_ms: 500 },
    loyalty_discounts: "off", unlocked: ["dashboard", "logs", "deploys"], findings: [],
    status_updates: [], actions_taken: [], allowed_actions: [], nudge, stakeholder_message: "How is checkout?",
  } }));
  await page.routeWebSocket("**/ws/voice?*", relay => {
    const url = new URL(relay.url());
    const call = url.searchParams.get("call");
    expect(url.searchParams.get("mode")).toBe("text");
    calls.push(call ?? "");
    relay.send(JSON.stringify({ type: "ready", call, mode: "text", engine: "scripted" }));
  });
  await page.goto("/night");
  await expect(page.getByText("Dana is calling for a status update.")).toBeVisible();
  await page.getByRole("button", { name: "Answer Dana’s nudge by text" }).click();
  await expect(page.getByRole("heading", { name: "Dana help" })).toBeVisible();
  await expect(page.getByText("Dana is calling for a status update.")).toHaveCount(0);
  expect(calls).toEqual(["help"]);

  phase = "stabilized";
  nudge = false;
  await page.getByRole("button", { name: "End help call" }).click();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Dana debrief by text" })).toHaveCount(0);
  phase = "fixed";
  await page.getByRole("button", { name: "Open Dana debrief by text" }).click();
  await expect(page.getByRole("heading", { name: "Dana debrief" })).toBeVisible();
  await expect.poll(() => calls).toEqual(["help", "debrief"]);
});
