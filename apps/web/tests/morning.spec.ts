import { expect, test } from "@playwright/test";
import type { IncidentState } from "../../../packages/contracts/types";

const api = process.env.NIGHT_TEST_API_ORIGIN;
const peer = process.env.NIGHT_TEST_PEER_ORIGIN;
const pilot = "https://github.com/shopnorth/shopnorth-checkout/pull/";

test("rates the handoff, verifies and deploys the PR, debriefs, and connects by mutual consent", async ({ page, browser, request }) => {
  test.skip(!api || !peer || process.env.NIGHT_TEST_MORNING !== "1", "Run the local Morning API fixture and two web identities.");
  test.setTimeout(75_000);
  const headers = { "X-Demo-User": "demo-a" };
  const created = await request.post(`${api}/api/incident/start`, { headers, data: { level: "explore" } });
  expect(created.status()).toBe(201);
  const { incident_id: id }: IncidentState = await created.json();
  const state = async (): Promise<IncidentState> => (await request.get(`${api}/api/incident/${id}`)).json();

  await page.goto(`/night?incident=${id}`);
  await page.getByText("Take the baseline check", { exact: true }).click();
  await page.getByRole("radio", { name: /Read the logs until/ }).check();
  await page.getByRole("button", { name: "Save baseline answer" }).click();
  await expect(page.getByText("Baseline saved.", { exact: false })).toBeVisible();
  for (const action of ["answer", "rollback"]) {
    const response = await request.post(`${api}/api/incident/${id}/action`, { headers, data: { action, idempotency_key: action } });
    expect(response.ok()).toBe(true);
  }
  await expect.poll(async () => (await state()).phase, { timeout: 15_000 }).toBe("stabilized");

  const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  try {
    const other = await otherContext.newPage();
    const morningPath = `/morning?incident=${id}`;
    await other.goto(`${peer}${morningPath}`);
    await expect(other.getByText("This incident is unavailable to this demo member.")).toBeVisible();
    expect((await other.request.get(`${peer}/api/morning?incident=${id}&resource=evidence`)).status()).toBe(404);

    const handoff = await request.post(`${api}/api/incident/${id}/handoff`, { headers, data: {
      what_happened: "Guest checkout failed during the sale.",
      current_state: "Checkout recovered after rollback and discounts are off.",
      tried: "Rolled back to v2.13.9.",
      risks: "The permanent fix needs a guest checkout regression test.",
      morning_pair: ["demo-b"],
    } });
    expect(handoff.ok()).toBe(true);
    await page.getByRole("link", { name: "Open Morning workspace" }).click();
    await expect(page).toHaveURL(morningPath);
    await expect(page.getByRole("heading", { name: "Fix the checkout regression" })).toBeVisible();
    await expect(page.getByText("Rehearsal GitHub fixture", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save handoff rating" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Debrief with Dana by text" })).toHaveCount(0);
    await other.reload();
    await expect(other.getByRole("region", { name: "Night shift handoff" })).toContainText("Guest checkout failed during the sale.");
    await other.getByLabel("Handoff usefulness").selectOption("5");
    await other.getByLabel("One line of feedback (optional)").fill("Clear rollback and remaining risk.");
    await other.getByRole("button", { name: "Save handoff rating" }).click();
    await expect(page.getByText("Usefulness 5/5 · demo-b", { exact: false })).toBeVisible();

    await other.getByText("Explore practice review · Scenario sample", { exact: true }).click();
    await other.getByLabel("Practice review note").fill("Cover missing and unknown tiers.");
    await other.getByRole("button", { name: "Compare with review notes" }).click();
    await expect(other.getByText("Check that guest and unknown tiers", { exact: false })).toBeVisible();
    expect((await state()).pr).toBeNull();

    const field = other.getByRole("textbox", { name: "GitHub pull request" });
    const verify = other.getByRole("button", { name: /^(Verify|Recheck) pull request$/ });
    async function checkPull(number: number) {
      await field.fill(pilot + number);
      await verify.click();
    }
    await checkPull(17);
    await expect(other.getByText("GitHub could not be reached.", { exact: false })).toBeVisible();
    await expect(other.getByRole("link", { name: "Open submitted PR on GitHub" })).toHaveAttribute("href", pilot + "17");
    await checkPull(15);
    await expect(other.getByText("This PR does not change the checkout code for this incident.")).toBeVisible();
    expect((await state()).pr).toBeNull();
    await checkPull(13);
    await expect(other.getByRole("heading", { name: "Last verified PR #13" })).toBeVisible();
    await expect(other.getByText("Pending", { exact: true })).toBeVisible();
    await expect(other.getByRole("button", { name: "Deploy fix", exact: true })).toHaveCount(0);
    await checkPull(14);
    await expect(other.getByRole("heading", { name: "Last verified PR #14" })).toBeVisible();
    await expect(other.getByText("Failed", { exact: true })).toBeVisible();
    await expect(other.getByRole("button", { name: "Deploy fix", exact: true })).toHaveCount(0);
    await checkPull(16);
    await expect(other.getByRole("heading", { name: "Last verified PR #16" })).toBeVisible();
    await expect(other.getByText("Substantive review pending · 0 non-author")).toBeVisible();
    await expect(other.getByRole("button", { name: "Deploy fix", exact: true })).toHaveCount(0);
    await checkPull(12);
    await expect(other.getByRole("heading", { name: "Last verified PR #12" })).toBeVisible();
    await expect(other.getByText("Substantive review recorded", { exact: false })).toBeVisible();
    await expect(other.getByRole("link", { name: "Open verified PR on GitHub" })).toHaveAttribute("href", pilot + "12");
    const deploy = other.getByRole("button", { name: "Deploy fix", exact: true });
    await deploy.focus();
    await deploy.press("Enter");
    await expect(other.getByRole("dialog")).toContainText("PR #12");
    const confirm = other.getByRole("button", { name: "Confirm deploy" });
    let changedHead = true;
    await other.route(`**/api/night?incident=${id}`, async route => {
      if (!changedHead || route.request().method() !== "GET") return route.continue();
      const response = await route.fetch();
      const incident: IncidentState = await response.json();
      await route.fulfill({ response, json: { ...incident, pr: { ...incident.pr, head_sha: "new-head" } } });
    });
    await expect(confirm).toBeDisabled();
    await expect(other.getByRole("dialog")).toContainText("PR changed");
    await other.keyboard.press("Escape");
    await expect(deploy).toBeFocused();
    expect((await state()).status).toBe("rolled_back");
    changedHead = false;
    await expect(other.getByText("phase4-12", { exact: true })).toBeVisible();
    await deploy.press("Enter");
    await confirm.click();
    await expect(page.getByText("Fix deployed · Discounts on")).toBeVisible();
    expect((await state()).allowed_actions).not.toContain("deploy_fix");
    expect((await state()).status).toBe("fixed");

    let checkWrites = 0;
    let connectionWrites = 0;
    await page.route(`**/api/morning?incident=${id}`, async route => {
      const operation = route.request().postDataJSON()?.operation;
      if (operation === "check") checkWrites++;
      else if (operation === "connect") connectionWrites++;
      else return route.continue();
      const accepted = await route.fetch();
      expect(accepted.ok()).toBe(true);
      await route.abort("failed");
    });
    await page.getByRole("radio", { name: /Roll back the release/ }).check();
    await page.getByRole("button", { name: "Save follow-up answer" }).click();
    await expect(page.getByText("After score", { exact: true })).toBeVisible();
    expect(checkWrites).toBe(1);
    await page.getByRole("button", { name: "Debrief with Dana by text" }).click();
    await expect(page.getByRole("log", { name: "Dana captions" })).toContainText("What would you tell our customers");
    await page.getByRole("textbox", { name: "Message Dana" }).fill(
      "About a third of checkouts failed because guests had no loyalty tier. We rolled back, added a regression test, and deployed the fix. Monitor checkout for a repeat.",
    );
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await expect(page.getByRole("heading", { name: /Final server rubric/ })).toBeVisible();
    const evidence = page.getByRole("region", { name: "Private incident evidence" });
    await expect(evidence).toContainText("phase4-12");
    await expect(evidence).toContainText("Recorded for demo-a");
    await expect(other.getByRole("region", { name: "Private incident evidence" })).toContainText("Recorded for demo-b");

    const requestConnection = page.getByRole("button", { name: "Request connection with demo-b" });
    await requestConnection.click();
    await expect(requestConnection).toHaveCount(0);
    expect(connectionWrites).toBe(1);
    await expect(page.getByText("Mutual connection", { exact: true })).toHaveCount(0);
    await other.getByRole("button", { name: "Request connection with demo-a" }).tap();
    await expect(other.getByText("Mutual connection", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Refresh connections" }).click();
    await expect(page.getByText("Mutual connection", { exact: true })).toBeVisible();
    const network = page.getByRole("region", { name: "Work together again" });
    await expect(network).toContainText("Explore · debriefed");
    await expect(network.getByRole("link", { name: "Open shared PR on GitHub" })).toHaveAttribute("href", pilot + "12");
    expect(await other.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    let evidenceStatus = 503;
    await page.route(`**/api/morning?incident=${id}&resource=evidence`, route => route.fulfill({ status: evidenceStatus }));
    const refreshEvidence = evidence.getByRole("button", { name: "Refresh private evidence" });
    await refreshEvidence.focus();
    await refreshEvidence.press("Enter");
    await expect(evidence.getByRole("alert")).toContainText("Showing the last loaded record");
    await expect(evidence).toContainText("Recorded for demo-a");
    await expect(refreshEvidence).toBeFocused();

    evidenceStatus = 403;
    await refreshEvidence.press("Enter");
    await expect(evidence.getByRole("alert")).toContainText("The evidence record is unavailable");
    await expect(evidence.getByText(/Recorded for/)).toHaveCount(0);
    for (const width of [320, 1440]) {
      await other.setViewportSize({ width, height: 844 });
      expect(await other.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  } finally {
    await otherContext.close();
  }
});

test("keeps Deploy unavailable for a merged green PR with only self-review", async ({ page, request }) => {
  test.skip(!api || process.env.NIGHT_TEST_MORNING !== "1", "Run the local Morning API fixture.");
  const headers = { "X-Demo-User": "demo-a" };
  const created = await request.post(`${api}/api/incident/start`, { headers, data: { level: "explore" } });
  expect(created.status()).toBe(201);
  const { incident_id: id }: IncidentState = await created.json();
  const incident = `${api}/api/incident/${id}`;
  for (const action of ["answer", "rollback"]) {
    const result = await request.post(`${incident}/action`, { headers, data: { action, idempotency_key: action } });
    expect(result.ok()).toBe(true);
  }
  await expect.poll(async () => (await (await request.get(incident)).json()).phase, { timeout: 15_000 }).toBe("stabilized");
  const handoff = await request.post(`${incident}/handoff`, { headers, data: {
    what_happened: "Guest checkout failed.", current_state: "Recovered after rollback.",
    tried: "Rolled back the release.", risks: "Add the missing-tier regression test.",
  } });
  expect(handoff.ok()).toBe(true);
  await page.goto(`/morning?incident=${id}`);
  await page.getByRole("textbox", { name: "GitHub pull request" }).fill(pilot + "18");
  await page.getByRole("button", { name: "Verify pull request" }).click();
  const review = page.getByRole("region", { name: "Verify the checkout fix" });
  await expect(review.getByText("Passing", { exact: true })).toBeVisible();
  await expect(review.getByText("Merged", { exact: true })).toBeVisible();
  await expect(review.getByText(/0 non-author/)).toBeVisible();
  expect((await (await request.get(incident)).json()).allowed_actions).toContain("deploy_fix");
  await expect(review.getByRole("button", { name: "Deploy fix", exact: true })).toHaveCount(0);
  await expect(review.getByText(/independent review is required/)).toBeVisible();
});
