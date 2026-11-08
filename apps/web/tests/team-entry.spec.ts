import { expect, test } from "@playwright/test";
import type { IncidentState } from "../../../packages/contracts/types";

const api = process.env.NIGHT_TEST_API_ORIGIN;
const teamEntry = process.env.NIGHT_TEST_TEAM_ENTRY === "1";
const savedKey = "incident-lab.team-entry.v1.demo-a.incident";

test("joins a real cohort, starts a selected team, and resumes the same incident", async ({ page, request }) => {
  test.skip(!api || !teamEntry, "Start the team backend and opt into the team entry test.");
  const headers = { "X-Demo-User": "demo-b" };
  const created = await request.post(`${api}/api/cohorts`, { headers, data: { name: "Night browser team" } });
  expect(created.status()).toBe(201);
  const cohort = await created.json();

  await page.goto("/");
  await page.getByRole("link", { name: "Start simulation" }).click();
  await page.getByRole("radio", { name: /Challenge/ }).check();
  const code = page.getByRole("textbox", { name: "Team cohort code" });
  await code.fill(cohort.join_code === "ZZZZZZ" ? "XXXXXX" : "ZZZZZZ");
  await page.getByRole("button", { name: "Join team cohort" }).click();
  await expect(page.getByText("That cohort code was not found.", { exact: false })).toBeVisible();
  await code.fill(cohort.join_code.toLowerCase());
  await page.getByRole("button", { name: "Join team cohort" }).click();
  await expect(page.getByRole("group", { name: "Night browser team members" })).toBeVisible();
  await page.reload();
  const teammate = page.getByRole("checkbox", { name: "demo-b" });
  await teammate.check();
  const anotherMember = await request.post(`${api}/api/cohorts/join`, {
    headers: { "X-Demo-User": "luan" }, data: { join_code: cohort.join_code },
  });
  expect(anotherMember.ok()).toBe(true);
  await page.getByRole("button", { name: "Refresh cohort roster" }).click();
  await expect(page.getByRole("checkbox", { name: "luan" })).toBeVisible();
  await expect(teammate).toBeChecked();
  await page.getByRole("radio", { name: /Challenge/ }).check();
  await page.getByRole("button", { name: "Start with selected teammates" }).click();
  await expect(page.getByRole("heading", { name: "Dana is calling." })).toBeVisible();
  const url = page.url();
  const id = new URL(url).searchParams.get("incident");
  expect(id).toMatch(/^inc_[a-f0-9]{8}$/);
  const state = await request.get(`${api}/api/incident/${id}`);
  const incident: IncidentState & { teammates: string[] } = await state.json();
  expect(incident.level).toBe("challenge");
  expect(incident.teammates).toEqual(["demo-a", "demo-b"]);
  await page.getByRole("link", { name: "Incident Lab" }).click();
  await page.getByRole("link", { name: "Resume API incident" }).click();
  await expect(page).toHaveURL(url);
  await expect(page.getByRole("heading", { name: "Dana is calling." })).toBeVisible();

  const other = await request.post(`${api}/api/incident/start`, { headers, data: { level: "explore" } });
  const otherId = (await other.json()).incident_id;
  const outsider = await page.request.get(`/api/night?incident=${otherId}`);
  expect(outsider.status()).toBe(404);
  await page.evaluate(({ savedKey, otherId }) => localStorage.setItem(savedKey, otherId), { savedKey, otherId });
  await page.goto("/start");
  await expect(page.getByText("The saved incident is unavailable.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Resume API incident" })).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), savedKey)).toBeNull();

  await page.evaluate(({ savedKey, id }) => localStorage.setItem(savedKey, id!), { savedKey, id });
  await page.route("**/api/night?incident=*", route => route.fulfill({ status: 503 }));
  await page.reload();
  await expect(page.getByText("The saved incident could not be checked.", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Resume API incident" })).toBeVisible();
  expect(await page.evaluate(key => localStorage.getItem(key), savedKey)).toBe(id);
});

for (const operation of ["Join", "failed Start"] as const) {
  test(`keeps the saved Resume link when validation completes during ${operation}`, async ({ page, request }) => {
    test.skip(!api || !teamEntry, "Start the team backend and opt into the team entry test.");
    const created = await request.post(`${api}/api/incident/start`, {
      headers: { "X-Demo-User": "demo-a" }, data: { level: "explore" },
    });
    expect(created.status()).toBe(201);
    const { incident_id: id }: IncidentState = await created.json();
    await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), { key: savedKey, value: id });

    const allowLookup = Promise.withResolvers<void>();
    const allowSubmission = Promise.withResolvers<void>();
    await page.route(`**/api/night?incident=${id}`, async route => {
      await allowLookup.promise;
      await route.continue();
    });
    await page.route("**/api/night/entry", async route => {
      await allowSubmission.promise;
      if (operation === "Join") await route.continue();
      else await route.fulfill({ status: 503 });
    });

    try {
      await page.goto("/start");
      if (operation === "Join") {
        const cohort = await request.post(`${api}/api/cohorts`, {
          headers: { "X-Demo-User": "demo-b" }, data: { name: "Resume race cohort" },
        });
        expect(cohort.status()).toBe(201);
        const { join_code: code } = await cohort.json();
        await page.getByRole("textbox", { name: "Team cohort code" }).fill(code);
        await page.getByRole("button", { name: "Join team cohort" }).click();
      } else {
        await page.getByRole("button", { name: "Start solo incident" }).click();
      }
      await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();
      const resume = page.getByRole("link", { name: "Resume API incident" });
      allowLookup.resolve();
      await expect(resume).toHaveAttribute("href", `/night?incident=${id}`);
      await expect(page.getByRole("button", { name: "Working…" })).toBeDisabled();

      allowSubmission.resolve();
      if (operation === "Join") {
        await expect(page.getByRole("group", { name: "Resume race cohort members" })).toBeVisible();
      } else {
        await expect(page.getByRole("alert").filter({ hasText: "The API did not confirm the start." })).toBeVisible();
      }
      await expect(resume).toHaveAttribute("href", `/night?incident=${id}`);
      expect(await page.evaluate(key => localStorage.getItem(key), savedKey)).toBe(id);
    } finally {
      allowLookup.resolve();
      allowSubmission.resolve();
    }
  });
}

test("cancels older validation when Start creates a replacement incident", async ({ page, request }) => {
  test.skip(!api || !teamEntry, "Start the team backend and opt into the team entry test.");
  const created = await request.post(`${api}/api/incident/start`, {
    headers: { "X-Demo-User": "demo-a" }, data: { level: "explore" },
  });
  expect(created.status()).toBe(201);
  const { incident_id: id }: IncidentState = await created.json();
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, value);
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (storageKey, item) {
      if (storageKey === key) throw new DOMException("Blocked storage", "QuotaExceededError");
      setItem.call(this, storageKey, item);
    };
  }, { key: savedKey, value: id });

  const release = Promise.withResolvers<void>();
  const lookupStarted = Promise.withResolvers<void>();
  await page.route(`**/api/night?incident=${id}`, async route => {
    lookupStarted.resolve();
    await release.promise;
    await route.fulfill({ status: 503 });
  });
  try {
    await page.goto("/start");
    await lookupStarted.promise;
    const aborted = page.waitForEvent("requestfailed", req => new URL(req.url()).searchParams.get("incident") === id);
    const started = page.waitForResponse(res => res.url().endsWith("/api/night/entry") && res.status() === 201);
    await page.getByRole("button", { name: "Start solo incident" }).click();
    const { id: replacement } = await (await started).json();
    expect(replacement).not.toBe(id);
    await expect(page.getByRole("link", { name: "Resume API incident" })).toHaveAttribute("href", `/night?incident=${replacement}`);
    await expect(page.getByText(/This browser could not save an entry link/)).toBeVisible();
    await expect(page).toHaveURL("/start");
    await aborted;
    await expect(page.getByText(/The saved incident could not be checked/)).toHaveCount(0);
  } finally {
    release.resolve();
  }
});
