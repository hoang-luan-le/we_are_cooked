import { expect, test, type Page } from "@playwright/test";

async function answerDana(page: Page) {
  await page.goto("/night");
  await page.getByRole("button", { name: "Answer Dana" }).click();
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeFocused();
}

test("walks from the landing through diagnosis and simulated recovery", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", error => errors.push(error));
  let socketCount = 0;
  page.on("websocket", () => socketCount++);
  await page.goto("/");
  await page.getByRole("link", { name: "Start Night 2D" }).click();
  await expect(page.getByText("Development fixture", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Answer Dana" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeFocused();
  await page.getByRole("textbox", { name: "Message Dana" }).fill("What changed?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("log", { name: "Dana captions" })).toContainText("A release went out at 01:47");
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeFocused();
  await expect(page.getByText("Degraded", { exact: true })).toBeVisible();

  await page.getByRole("combobox", { name: "Severity" }).selectOption("error");
  await expect(page.getByText("2 entries", { exact: true })).toBeVisible();
  await page.getByText("POST /checkout 500 · guest checkout").first().click();
  await expect(page.getByText("checkout/pricing.py:18", { exact: false }).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search logs" }).fill("no matches");
  await expect(page.getByText("No logs match these filters.")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search logs" }).clear();
  await page.getByText("Inspect v2.14.0 fixture diff").click();
  await expect(page.getByText("+ discount = LOYALTY_DISCOUNTS[tier]", { exact: false })).toBeVisible();

  const rollback = page.getByRole("button", { name: "Roll back to v2.13.9" });
  await rollback.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(rollback).toBeFocused();
  await expect(page.getByText("Degraded", { exact: true })).toBeVisible();
  await page.getByText("Read chart values", { exact: false }).click();
  await rollback.click();
  await dialog.getByRole("button", { name: "Confirm rollback" }).click();
  await expect(page.getByText("Recovering", { exact: true })).toBeVisible();
  await expect(rollback).toBeDisabled();
  await expect(page.getByRole("row", { name: "02:04:02 18.3% 344" })).toBeVisible();
  await expect(page.getByText("Recovered", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole("row", { name: "02:04:09 0.4% 420" })).toBeVisible();
  await expect(page.getByText("Off", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "v2.13.9" })).toContainText("Active deploy");
  await expect(page.getByRole("combobox", { name: "Severity" })).toHaveValue("error");
  expect(socketCount).toBe(0);
  expect(errors).toEqual([]);
});

test.describe("mobile", () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 800 }, reducedMotion: "reduce" });

  test("snoozes and keeps the dashboard usable at narrow widths", async ({ page }) => {
    await page.clock.install();
    await page.goto("/night");
    const snooze = page.getByRole("button", { name: "Snooze" });
    await snooze.tap();
    await expect(page.getByRole("status")).toContainText("Page snoozed");
    await expect(snooze).toBeDisabled();
    await page.clock.runFor(5000);
    await expect(snooze).toBeEnabled();
    await page.getByRole("button", { name: "Answer Dana" }).tap();
    await page.getByRole("button", { name: "Continue to dashboard" }).tap();
    await expect(page.getByRole("heading", { name: "Deploy history" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });
});

test("speaks the shared text relay protocol and closes when leaving the call", async ({ page }) => {
  const sent: string[] = [];
  const requests: URLSearchParams[] = [];
  await page.routeWebSocket("**/ws/voice?*", relay => {
    requests.push(new URL(relay.url()).searchParams);
    relay.send(JSON.stringify({ type: "ready", call: "briefing", mode: "text" }));
    relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Test relay briefing" }));
    relay.onMessage(message => { if (typeof message === "string") sent.push(message); });
  });
  await answerDana(page);
  await page.getByRole("button", { name: "Use relay text" }).click();
  await expect(page.getByRole("log")).toContainText("Test relay briefing");
  expect(Object.fromEntries(requests[0])).toEqual({
    call: "briefing", incident_id: "inc_demo", user: "dev", level: "explore", mode: "text",
  });
  await page.getByRole("textbox", { name: "Message Dana" }).fill("What changed?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => sent.map(message => JSON.parse(message))).toContainEqual({ type: "text", text: "What changed?" });
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect.poll(() => sent.map(message => JSON.parse(message))).toContainEqual({ type: "hang_up" });
});

test("falls back on microphone denial and stays usable when the relay fails", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); };
  });
  const modes: string[] = [];
  await page.routeWebSocket("**/ws/voice?*", relay => {
    modes.push(new URL(relay.url()).searchParams.get("mode") ?? "");
    relay.send(JSON.stringify({ type: "error", code: "offline", message: "Test relay unavailable", fallback: "none" }));
  });
  await answerDana(page);
  await page.getByRole("button", { name: "Use relay voice" }).click();
  await expect(page.getByRole("status")).toContainText("text · failed");
  expect(modes).toEqual(["text"]);
  await expect(page.getByRole("region", { name: "Dana’s briefing" }).getByRole("alert")).toContainText("connection error");
  await page.getByRole("button", { name: "Use scripted briefing" }).click();
  await expect(page.getByRole("log")).toContainText("Checkout is failing");
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
});

test("sends 100 ms PCM16 mic frames and releases the fake mic on exit", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const generator = new AudioContext();
      const tone = generator.createOscillator();
      const output = generator.createMediaStreamDestination();
      tone.connect(output);
      tone.start();
      await generator.resume();
      const track = output.stream.getAudioTracks()[0];
      const stop = track.stop.bind(track);
      track.stop = () => {
        document.documentElement.dataset.micStopped = "yes";
        stop();
        tone.stop();
        void generator.close();
      };
      return output.stream;
    };
  });
  const frameSizes: number[] = [];
  const events: string[] = [];
  const modes: string[] = [];
  await page.routeWebSocket("**/ws/voice?*", relay => {
    modes.push(new URL(relay.url()).searchParams.get("mode") ?? "");
    relay.send(JSON.stringify({ type: "ready", call: "briefing", mode: "voice" }));
    relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Test voice caption" }));
    relay.send(Buffer.alloc(4800));
    relay.onMessage(message => {
      if (typeof message === "string") events.push(message);
      else frameSizes.push(message.length);
    });
  });
  await answerDana(page);
  await page.getByRole("button", { name: "Use relay voice" }).click();
  await expect(page.getByRole("log")).toContainText("Test voice caption");
  expect(modes).toEqual(["voice"]);
  await expect.poll(() => frameSizes).toContain(3200);
  await page.getByRole("button", { name: "Mute mic" }).click();
  await expect.poll(() => events.map(message => JSON.parse(message))).toContainEqual({ type: "mute", on: true });
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-mic-stopped", "yes");
});
