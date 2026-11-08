import { expect, test } from "@playwright/test";
import type { ActionRequest, IncidentState } from "../../../packages/contracts/types";

const api = process.env.NIGHT_TEST_API_ORIGIN;
const peer = process.env.NIGHT_TEST_PEER_ORIGIN;

test("two demo members investigate, share evidence, count one Help call, and hand off after rollback", async ({ page, browser, request }) => {
  test.skip(!api || !peer || process.env.NIGHT_TEST_TEAM_ENTRY !== "1", "Run the team backend and two local web identities.");
  test.setTimeout(60_000);
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
  const logsPath = `/api/night/panels?incident=${id}&panel=logs`;
  expect((await page.request.get(logsPath)).status()).toBe(403);
  const outsiderIncident = await request.post(`${api}/api/incident/start`, {
    headers: { "X-Demo-User": "demo-b" }, data: { level: "explore" },
  });
  const outsiderId = (await outsiderIncident.json()).incident_id;
  expect((await page.request.get(`/api/night/panels?incident=${outsiderId}&panel=logs`)).status()).toBe(404);

  await page.getByRole("button", { name: "Open checkout logs" }).click();
  const logs = page.getByRole("region", { name: "Checkout logs" });
  await expect(logs.getByRole("heading")).toBeFocused();
  await logs.getByRole("searchbox", { name: "Search logs" }).fill("KeyError");
  await logs.getByRole("combobox", { name: "Severity" }).selectOption("ERROR");
  const results = logs.getByRole("region", { name: "Log results" });
  let failLogs = false;
  await page.route("**/api/night/panels?*", route =>
    failLogs && new URL(route.request().url()).searchParams.get("panel") === "logs"
      ? route.fulfill({ status: 503 }) : route.continue());
  await logs.getByRole("button", { name: "Load matching logs" }).click();
  await expect(results.getByText(/KeyError/).first()).toBeVisible();
  await expect(results.getByText("INFO", { exact: true })).toHaveCount(0);
  await results.locator("summary").first().click();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await results.getByRole("button", { name: "Copy log entry" }).click();
  await expect(logs.getByText(/Log entry at .* copied/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("KeyError");
  failLogs = true;
  await logs.getByRole("button", { name: "Load matching logs" }).click();
  await expect(logs.getByText("Refresh failed. Showing the last loaded data.")).toBeVisible();
  await expect(results.getByText(/KeyError/).first()).toBeVisible();
  failLogs = false;
  await logs.getByRole("button", { name: "Retry panel" }).click();
  await expect(logs.getByText("Refresh failed. Showing the last loaded data.")).toHaveCount(0);

  await page.getByRole("button", { name: "Open deploy history" }).click();
  await page.getByText("Inspect v2.14.0 diff · Scenario fallback").click();
  await expect(page.getByText("checkout/pricing.py", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open runbooks" }).click();
  await page.getByRole("button", { name: "Checkout error rate is high" }).click();
  await expect(page.getByRole("list", { name: "Checkout error rate is high" })).toContainText("last good version");
  await page.getByText("Incident timeline and metric history", { exact: true }).click();
  await expect(page.getByText(/bad release v2.14.0/)).toBeVisible();
  await expect(page.getByRole("table", { name: "Incident API metrics history" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Write shift handoff" })).toHaveCount(0);

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
    await expect(page.getByRole("region", { name: "Deploy history" })).toContainText("Active version at last load v2.13.9");
    await expect(page.getByRole("listitem").filter({ hasText: /\d\d:\d\d:\d\d · rollback/ })).toBeVisible();

    await page.getByRole("button", { name: "Write shift handoff" }).click();
    await expect(page.getByRole("textbox", { name: "What happened" })).toBeFocused();
    await page.getByRole("textbox", { name: "What happened" }).fill("Guest checkouts failed after the loyalty release.");
    await page.getByRole("textbox", { name: "Current state" }).fill("Checkout recovered and discounts are off.");
    await page.getByRole("textbox", { name: "What was tried" }).fill("Rolled back to v2.13.9.");
    await page.getByRole("textbox", { name: "Remaining risks" }).fill("A permanent fix needs a guest checkout regression test.");
    await page.getByRole("textbox", { name: "Morning teammate handles (optional)" }).fill("luan");
    await page.getByRole("button", { name: "Save shift handoff" }).click();
    await expect(page.getByText("Shift handoff saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Shift handoff" })).toBeFocused();
    await expect(other.getByRole("region", { name: "Shift handoff" })).toContainText("Checkout recovered and discounts are off.");
    await expect.poll(async () => (await state()).phase).toBe("handed_off");
    expect((await state()).handoff).toMatchObject({ by: "demo-a", morning_pair: ["luan"] });
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
