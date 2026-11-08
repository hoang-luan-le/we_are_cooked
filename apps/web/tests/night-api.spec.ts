import { expect, test, type WebSocketRoute } from "@playwright/test";
import type { ActionRequest, IncidentState } from "../../../packages/contracts/types";

const api = process.env.NIGHT_TEST_API_ORIGIN;

test("uses the demo API for Answer, diagnosis, rollback, recovery and refresh", async ({ page, request }) => {
  test.skip(!api, "Start an isolated backend and set NIGHT_TEST_API_ORIGIN.");
  const reset = await request.post(`${api}/api/demo/reset`, { headers: { "X-Demo-User": "demo-a" }, data: { level: "explore" } });
  expect(reset.ok()).toBe(true);
  const rollbackKeys: string[] = [];
  const briefingSockets: WebSocketRoute[] = [];
  let answerAccepted = false;
  await page.routeWebSocket("**/ws/voice?*", relay => {
    expect(answerAccepted).toBe(true);
    expect(new URL(relay.url()).searchParams.get("user")).toBe("demo-a");
    briefingSockets.push(relay);
    relay.send(JSON.stringify({ type: "ready", call: "briefing", mode: "text", engine: "scripted" }));
    relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Inspect checkout, then roll back safely." }));
  });
  await page.route("**/api/night", async route => {
    const action: ActionRequest | null = route.request().postDataJSON();
    if (action?.action === "answer") {
      const accepted = await route.fetch();
      expect(accepted.ok()).toBe(true);
      expect(briefingSockets).toHaveLength(0);
      answerAccepted = true;
      await route.fulfill({ response: accepted });
      return;
    }
    if (action?.action !== "rollback") {
      await route.continue();
      return;
    }
    rollbackKeys.push(action.idempotency_key);
    if (rollbackKeys.length === 1) {
      // The backend accepts the action, but the browser loses the acknowledgement.
      const accepted = await route.fetch();
      expect(accepted.ok()).toBe(true);
      await route.abort("failed");
    } else await route.continue();
  });

  await page.goto("/start");
  await page.getByRole("link", { name: "Open local API demo" }).click();
  await expect(page.getByText("Local demo API", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Answer Dana by text" }).click();
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeVisible();
  await expect(page.getByRole("log")).toContainText("Inspect checkout, then roll back safely.");
  expect(briefingSockets).toHaveLength(1);
  briefingSockets[0].send(JSON.stringify({ type: "call_ended", reason: "done" }));
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeFocused();
  await expect(page.getByText("API simulation clock")).toBeVisible();
  await page.getByRole("button", { name: "Open checkout logs" }).click();
  await expect(page.getByText("Scenario log samples")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checkout logs" })).toBeFocused();
  await page.getByRole("button", { name: "Open deploy history" }).click();
  await expect(page.getByText("Scenario release details")).toBeVisible();
  await page.getByRole("button", { name: "Roll back to v2.13.9" }).click();
  await page.getByRole("button", { name: "Confirm rollback" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByText("The API did not confirm this action.", { exact: false })).toBeVisible();
  await expect(page.getByText("Recovering", { exact: true })).toBeVisible();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await expect(page.getByRole("figure", { name: /Checkout error rate/ })).toContainText("0.4%");
  await page.getByRole("button", { name: "Retry last action" }).click();
  await expect.poll(() => rollbackKeys.length).toBe(2);
  expect(rollbackKeys[0]).toBe(rollbackKeys[1]);
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();

  const result = await request.get(`${api}/api/incident/inc_demo`);
  const state: IncidentState = await result.json();
  expect(state.phase).toBe("stabilized");
  expect(state.metrics.error_rate).toBe(0.4);
  expect(state.metrics.orders_per_min).toBe(420);
  expect(state.loyalty_discounts).toBe("off");
  expect(state.actions_taken).toEqual(["answer", "open_panel:dashboard", "open_panel:logs", "open_panel:deploys", "rollback"]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible();
});
