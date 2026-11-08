// Adapted from services/api/voice/dev_page.html. Emit 100 ms mono PCM16 LE frames.
class DanaMic extends AudioWorkletProcessor {
  constructor({ processorOptions }) {
    super();
    const { inputRate } = processorOptions;
    this.ratio = sampleRate / inputRate;
    this.frameBytes = inputRate / 10 * 2;
    this.offset = 0;
    this.position = 0;
    this.frame = new DataView(new ArrayBuffer(this.frameBytes));
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (const sample of channel) {
      this.position += 1;
      if (this.position < this.ratio) continue;
      this.position -= this.ratio;
      const clamped = Math.max(-1, Math.min(1, sample));
      this.frame.setInt16(this.offset, clamped * (clamped < 0 ? 0x8000 : 0x7fff), true);
      this.offset += 2;
      if (this.offset === this.frame.byteLength) {
        const buffer = this.frame.buffer;
        this.port.postMessage(buffer, [buffer]);
        this.frame = new DataView(new ArrayBuffer(this.frameBytes));
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("dana-mic", DanaMic);
