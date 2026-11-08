import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

async function answerDana(page: Page, mode: "text" | "voice") {
  await page.goto("/night");
  await page.getByRole("button", { name: mode === "voice" ? "Answer Dana with voice" : "Answer Dana by text" }).click();
  await expect(page.getByRole("heading", { name: "Dana’s briefing" })).toBeFocused();
}

test("walks from the landing through diagnosis and simulated recovery", async ({ page }) => {
  const errors: Error[] = [];
  page.on("pageerror", error => errors.push(error));
  let socketCount = 0;
  page.on("websocket", () => socketCount++);
  await page.goto("/");
  await page.getByRole("link", { name: "Start simulation" }).click();
  await expect(page).toHaveURL(/\/start$/);
  await page.goto("/night?fixture=1");
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
    await page.goto("/night?fixture=1");
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

test("answers by text in one click, follows captions and reports engine changes", async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      document.documentElement.dataset.micRequested = "yes";
      throw new Error("Text must not request audio");
    };
  });
  const sent: string[] = [];
  const requests: URLSearchParams[] = [];
  const relays: WebSocketRoute[] = [];
  await page.routeWebSocket("**/ws/voice?*", relay => {
    relays.push(relay);
    requests.push(new URL(relay.url()).searchParams);
    relay.send(JSON.stringify({ type: "ready", call: "briefing", mode: "text", engine: "deepgram" }));
    relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Test relay briefing" }));
    relay.onMessage(message => { if (typeof message === "string") sent.push(message); });
  });
  await answerDana(page, "text");
  await expect(page.getByRole("log")).toContainText("Test relay briefing");
  await expect(page.getByRole("status")).toContainText("text · Deepgram");
  await expect(page.locator("html")).not.toHaveAttribute("data-mic-requested", "yes");
  expect(Object.fromEntries(requests[0])).toEqual({
    call: "briefing", incident_id: "inc_demo", user: "dev", level: "explore", mode: "text",
  });
  await page.getByRole("textbox", { name: "Message Dana" }).fill("What changed?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect.poll(() => sent.map(message => JSON.parse(message))).toContainEqual({ type: "text", text: "What changed?" });
  const [relay] = relays;
  relay.send(JSON.stringify({ type: "ready", call: "briefing", mode: "text", engine: "scripted" }));
  for (let number = 1; number <= 20; number++) {
    relay.send(JSON.stringify({ type: "caption", role: "dana", text: `Caption ${number}` }));
  }
  await expect(page.getByRole("status")).toContainText("text · Scripted (no AI)");
  const log = page.getByRole("log");
  await expect(log.getByText("Caption 20")).toBeInViewport();
  await log.evaluate(element => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Caption while reviewing" }));
  await expect(log).toContainText("Caption while reviewing");
  await expect(log.getByText("Test relay briefing")).toBeInViewport();
  await log.evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event("scroll"));
  });
  relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Caption after returning to latest" }));
  await expect(log.getByText("Caption after returning to latest")).toBeInViewport();
  expect(requests).toHaveLength(1);
  relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Dana’s final text" }));
  relay.send(JSON.stringify({ type: "call_ended", reason: "done" }));
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeFocused();
  await expect(page.getByText("Dana’s final text")).toBeVisible();
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
  await answerDana(page, "voice");
  await expect(page.getByRole("status")).toContainText("text · failed");
  expect(modes).toEqual(["text"]);
  await expect(page.getByRole("region", { name: "Dana’s briefing" }).getByRole("alert")).toContainText("connection error");
  await page.getByRole("button", { name: "Use offline briefing" }).click();
  await expect(page.getByRole("status")).toContainText("Offline briefing");
  await expect(page.getByRole("log")).toContainText("Checkout is failing");
  await page.getByRole("button", { name: "Continue to dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeVisible();
});

async function installSyntheticMic(page: Page) {
  await page.addInitScript(() => {
    const NativeAudio = AudioContext;
    window.AudioContext = class extends NativeAudio {
      constructor() {
        super();
        const showState = () => { document.documentElement.dataset.audioState = this.state; };
        this.addEventListener("statechange", showState);
        window.addEventListener("test:suspend-audio", () => { void this.suspend(); });
      }
    };
    const starts: { when: number; rate: number }[] = [];
    const start = AudioBufferSourceNode.prototype.start;
    const stopSource = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
      if (this.buffer) {
        starts.push({ when: args[0] ?? 0, rate: this.buffer.sampleRate });
        document.documentElement.dataset.audioStarts = JSON.stringify(starts);
      }
      start.apply(this, args);
    };
    AudioBufferSourceNode.prototype.stop = function (when) {
      const root = document.documentElement;
      root.dataset.audioStops = String(Number(root.dataset.audioStops ?? "0") + 1);
      stopSource.call(this, when);
    };
    navigator.mediaDevices.getUserMedia = async () => {
      const generator = new NativeAudio();
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
}

test("keeps PCM in order, interrupts speech and text, and drains before advancing", async ({ page }) => {
  await installSyntheticMic(page);
  const root = page.locator("html");
  const frameSizes: number[] = [];
  const events: string[] = [];
  const relays: WebSocketRoute[] = [];
  await page.routeWebSocket("**/ws/voice?*", relay => {
    relays.push(relay);
    relay.send(JSON.stringify({ type: "ready", call: "briefing", mode: "voice", engine: "deepgram" }));
    relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Test voice caption" }));
    relay.onMessage(message => {
      if (typeof message === "string") events.push(message);
      else frameSizes.push(message.length);
    });
  });
  await answerDana(page, "voice");
  await expect(page.getByRole("log")).toContainText("Test voice caption");
  const [relay] = relays;
  expect(new URL(relay.url()).searchParams.get("mode")).toBe("voice");
  await expect.poll(() => frameSizes).toContain(3200);
  await page.getByRole("button", { name: "Mute mic" }).click();
  await expect.poll(() => events.map(message => JSON.parse(message))).toContainEqual({ type: "mute", on: true });
  relay.send(Buffer.alloc(48_000));
  relay.send(Buffer.alloc(48_000));
  const scheduled = async (): Promise<{ when: number; rate: number }[]> =>
    JSON.parse(await root.getAttribute("data-audio-starts") ?? "[]");
  await expect.poll(async () => (await scheduled()).length).toBe(2);
  const [first, second] = await scheduled();
  expect([first.rate, second.rate]).toEqual([24_000, 24_000]);
  expect(second.when - first.when).toBeCloseTo(1, 5);
  await page.getByRole("textbox", { name: "Message Dana" }).fill("Please pause");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(root).toHaveAttribute("data-audio-stops", "2");
  relay.send(Buffer.alloc(48_000));
  relay.send(Buffer.alloc(48_000));
  await expect.poll(async () => (await scheduled()).length).toBe(4);
  relay.send(JSON.stringify({ type: "user_started_speaking" }));
  await expect(root).toHaveAttribute("data-audio-stops", "4");
  await page.evaluate(() => window.dispatchEvent(new Event("test:suspend-audio")));
  await expect(root).toHaveAttribute("data-audio-state", "suspended");
  relay.send(Buffer.alloc(24_000));
  relay.send(JSON.stringify({ type: "caption", role: "dana", text: "Final voice caption" }));
  relay.send(JSON.stringify({ type: "call_ended", reason: "done" }));
  await expect(page.getByRole("status")).toContainText("draining");
  await expect(root).toHaveAttribute("data-mic-stopped", "yes");
  await expect(page.getByRole("button", { name: "Continue to dashboard" })).toBeDisabled();
  // The final half-second buffer must survive past its nominal duration while suspended.
  await page.waitForTimeout(750);
  await expect(root).toHaveAttribute("data-audio-stops", "4");
  await page.getByRole("button", { name: "Resume audio" }).click();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeFocused();
  await expect(page.getByText("Final voice caption")).toBeVisible();
  await expect(root).toHaveAttribute("data-audio-state", "closed");
  await expect(root).toHaveAttribute("data-audio-stops", "4");
});

test("preserves the briefing and draft on a server-requested text fallback", async ({ page }) => {
  await installSyntheticMic(page);
  const relays: WebSocketRoute[] = [];
  await page.routeWebSocket("**/ws/voice?*", relay => {
    relays.push(relay);
    const voice = new URL(relay.url()).searchParams.get("mode") === "voice";
    relay.send(JSON.stringify({ type: "ready", call: "briefing", mode: voice ? "voice" : "text", engine: voice ? "deepgram" : "scripted" }));
    relay.send(JSON.stringify({ type: "caption", role: "dana", text: voice ? "Voice caption" : "Text continued" }));
  });
  await answerDana(page, "voice");
  await expect(page.getByRole("log")).toContainText("Voice caption");
  const draft = page.getByRole("textbox", { name: "Message Dana" });
  await draft.fill("Unsent question");
  relays[0].send(JSON.stringify({ type: "error", code: "voice_unavailable", message: "Voice dropped", fallback: "text" }));
  await expect(page.getByRole("status")).toContainText("text · Scripted (no AI)");
  await expect(page.getByRole("log")).toContainText("Voice caption");
  await expect(page.getByRole("log")).toContainText("Text continued");
  await expect(draft).toHaveValue("Unsent question");
  await expect(draft).toBeFocused();
  relays[1].send(JSON.stringify({ type: "error", code: "offline", message: "Text dropped", fallback: "none" }));
  await page.getByRole("button", { name: "Use offline briefing" }).click();
  await expect(page.getByRole("log")).toContainText("Voice caption");
  await expect(page.getByRole("log")).toContainText("Text continued");
  await expect(page.getByRole("log")).toContainText("Checkout is failing");
  await expect(draft).toHaveValue("Unsent question");
  await expect(page.locator("html")).toHaveAttribute("data-mic-stopped", "yes");
  expect(relays).toHaveLength(2);
});

test("can skip suspended terminal audio and keeps the final caption", async ({ page }) => {
  await installSyntheticMic(page);
  let relay: WebSocketRoute | undefined;
  await page.routeWebSocket("**/ws/voice?*", socket => {
    relay = socket;
    socket.send(JSON.stringify({ type: "ready", call: "briefing", mode: "voice", engine: "deepgram" }));
  });
  await answerDana(page, "voice");
  await expect(page.getByText(/Dana relay · voice · Deepgram/)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("test:suspend-audio")));
  await expect(page.locator("html")).toHaveAttribute("data-audio-state", "suspended");
  relay!.send(Buffer.alloc(48_000));
  relay!.send(JSON.stringify({ type: "caption", role: "dana", text: "Review the recent release." }));
  relay!.send(JSON.stringify({ type: "call_ended", reason: "done" }));
  await page.getByRole("button", { name: "Skip remaining audio" }).click();
  await expect(page.getByRole("heading", { name: "Checkout incident" })).toBeFocused();
  await expect(page.getByText("Review the recent release.", { exact: false })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-audio-state", "closed");
  await expect(page.locator("html")).toHaveAttribute("data-audio-stops", "1");
});
