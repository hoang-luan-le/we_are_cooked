// Ringtone and vibration, mixed separately. Uses /world/audio/ring.mp3 and buzz.mp3 when present, and generated cues otherwise.
const PERIOD = 2.8;
const PULSES = [0, 0.55];
const PULSE = 0.36;
/** Set true once ring.mp3 and buzz.mp3 are in public/world/audio. Off, so a missing file does not log a 404 on every load. */
const REAL_SOUNDS = false;

function synthRing(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * PERIOD), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  const notes = [[0, 1046.5], [0.16, 1318.5], [0.32, 1568], [0.48, 1318.5], [0.8, 1046.5], [0.96, 1318.5], [1.12, 1568], [1.28, 2093]];
  for (const [at, hz] of notes) {
    const start = Math.floor(at * ctx.sampleRate);
    for (let i = start; i < Math.min(data.length, start + ctx.sampleRate * 0.6); i++) {
      const t = (i - start) / ctx.sampleRate;
      data[i] += Math.exp(-t * 7) * Math.min(1, t * 400) * (Math.sin(2 * Math.PI * hz * t) * 0.6 + Math.sin(4 * Math.PI * hz * t) * 0.14) * 0.32;
    }
  }
  return buffer;
}

function synthBuzz(ctx: BaseAudioContext) {
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * PULSE), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / ctx.sampleRate;
    const edge = Math.min(1, t * 60, (PULSE - t) * 60);
    data[i] = edge * (Math.sign(Math.sin(2 * Math.PI * 148 * t)) * 0.35 + Math.sin(2 * Math.PI * 296 * t) * 0.3 + (Math.random() - 0.5) * 0.08) * 0.5;
  }
  return buffer;
}

export class PhoneAudio {
  private ctx?: AudioContext;
  private ring?: AudioBuffer; private buzz?: AudioBuffer;
  private ringGain?: GainNode; private buzzGain?: GainNode;
  private loop?: AudioBufferSourceNode;
  private timer = 0;
  private startedAt = 0;
  active = false;
  source: "files" | "generated" = "generated";

  constructor() {
    window.addEventListener("pointerdown", this.unlock, true);
    window.addEventListener("keydown", this.unlock, true);
    void this.prepare();
  }

  private async prepare() {
    try {
      const ctx = new AudioContext();
      this.ctx = ctx;
      this.ringGain = ctx.createGain(); this.ringGain.gain.value = 0.3; this.ringGain.connect(ctx.destination);
      this.buzzGain = ctx.createGain(); this.buzzGain.gain.value = 0.42; this.buzzGain.connect(ctx.destination);
      const load = async (url: string) => {
        const response = await fetch(url);
        if (!response.ok) return undefined;
        return ctx.decodeAudioData(await response.arrayBuffer());
      };
      const [ring, buzz] = REAL_SOUNDS ? await Promise.all([load("/world/audio/ring.mp3").catch(() => undefined), load("/world/audio/buzz.mp3").catch(() => undefined)]) : [undefined, undefined];
      if (ring && buzz) this.source = "files";
      this.ring = ring ?? synthRing(ctx);
      this.buzz = buzz ?? synthBuzz(ctx);
      if (this.active) this.beginSound();
    } catch {
      this.ctx = undefined; // The ring and vibration stay visible without sound.
    }
  }

  private unlock = () => { if (this.ctx?.state === "suspended") void this.ctx.resume().catch(() => undefined); };

  get state() { return this.ctx?.state ?? "unavailable"; }

  private beginSound() {
    const ctx = this.ctx;
    if (!ctx || !this.ring || !this.ringGain || this.loop) return;
    const loop = ctx.createBufferSource();
    loop.buffer = this.ring; loop.loop = true; loop.connect(this.ringGain); loop.start();
    this.loop = loop;
    const pulses = () => {
      if (!this.active || !this.buzz || !this.buzzGain) return;
      for (const offset of PULSES) {
        const one = ctx.createBufferSource();
        one.buffer = this.buzz; one.connect(this.buzzGain);
        one.start(ctx.currentTime + offset, 0, PULSE);
      }
    };
    pulses();
    this.timer = window.setInterval(pulses, PERIOD * 1000);
  }

  start() {
    if (this.active) return; // Never two loops, including after reopening or resuming.
    this.active = true;
    this.startedAt = performance.now();
    this.unlock();
    this.beginSound();
  }

  stop() {
    this.active = false;
    window.clearInterval(this.timer);
    try { this.loop?.stop(); } catch { /* Already stopped. */ }
    this.loop = undefined;
  }

  /** 0 to 1. The physical phone movement reads this, so it follows the same two pulses as the sound. */
  vibration(now: number) {
    if (!this.active) return 0;
    const t = ((now - this.startedAt) / 1000) % PERIOD;
    return PULSES.some(at => t >= at && t < at + PULSE) ? 1 : 0;
  }

  dispose() {
    this.stop();
    window.removeEventListener("pointerdown", this.unlock, true);
    window.removeEventListener("keydown", this.unlock, true);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
  }
}
