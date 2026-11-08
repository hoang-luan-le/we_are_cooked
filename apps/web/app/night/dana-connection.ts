import {
  DANA_INPUT_RATE, DANA_OUTPUT_RATE, danaUrl,
  type DanaClientMsg, type DanaMode, type DanaServerMsg, type Level,
} from "../../../../packages/contracts/dana";

export type DanaConnection = {
  close: () => void;
  send: (message: DanaClientMsg) => boolean;
};

type Options = {
  base: string;
  mode: DanaMode;
  session?: { incidentId: string; user: string; level: Level };
  onEvent: (event: DanaServerMsg) => void;
  onFailure: (message: string, allowText: boolean) => void;
};

// Adapted from services/api/voice/dev_page.html, with one lifecycle per call.
export function connectDana({ base, mode, session, onEvent, onFailure }: Options): DanaConnection {
  let socket: WebSocket | undefined;
  let audio: AudioContext | undefined;
  let mic: MediaStream | undefined;
  let capture: AudioWorkletNode | undefined;
  let closed = false;
  let ready = false;
  let muted = false;
  let draining = false;
  let playHead = 0;
  let drainTimer: number | undefined;
  const sources = new Set<AudioBufferSourceNode>();

  const connectionTimer = window.setTimeout(() => {
    fail("Dana took too long to connect.", true);
  }, 12_000);

  function stopMic() {
    mic?.getTracks().forEach(track => track.stop());
    if (capture) {
      capture.port.onmessage = null;
      capture.disconnect();
    }
    capture = undefined;
    mic = undefined;
  }

  function stopPlayback() {
    for (const source of sources) source.stop();
    sources.clear();
    playHead = 0;
  }

  function release() {
    if (closed) return;
    closed = true;
    window.clearTimeout(connectionTimer);
    window.clearTimeout(drainTimer);
    stopMic();
    stopPlayback();
    if (audio && audio.state !== "closed") void audio.close();
    socket?.close();
  }

  function fail(message: string, allowText: boolean) {
    if (closed || draining) return;
    release();
    onFailure(message, allowText);
  }

  function send(message: DanaClientMsg) {
    if (!ready || closed || draining || socket?.readyState !== WebSocket.OPEN) return false;
    if (message.type === "mute") muted = message.on;
    socket.send(JSON.stringify(message));
    return true;
  }

  function playChunk(data: ArrayBuffer) {
    if (!audio || data.byteLength < 2 || data.byteLength % 2 !== 0) return;
    const pcm = new DataView(data);
    const buffer = audio.createBuffer(1, data.byteLength / 2, DANA_OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < channel.length; index++) {
      channel[index] = pcm.getInt16(index * 2, true) / 0x8000;
    }
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.connect(audio.destination);
    if (playHead < audio.currentTime) playHead = audio.currentTime + 0.03;
    source.start(playHead);
    playHead += buffer.duration;
    sources.add(source);
    source.onended = () => sources.delete(source);
  }

  function startCapture() {
    if (!audio || !mic) return;
    capture = new AudioWorkletNode(audio, "dana-mic", {
      processorOptions: { inputRate: DANA_INPUT_RATE },
    });
    capture.onprocessorerror = () => fail("Microphone capture stopped.", true);
    capture.port.onmessage = ({ data }: MessageEvent<ArrayBuffer>) => {
      if (!closed && !draining && !muted && socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 256_000) {
        socket.send(data);
      }
    };
    audio.createMediaStreamSource(mic).connect(capture).connect(audio.destination);
  }

  function handleEvent(event: DanaServerMsg) {
    if (!ready && event.type !== "ready" && event.type !== "error" && event.type !== "call_ended") return;
    switch (event.type) {
      case "ready":
        if (ready || event.call !== "briefing" || event.mode !== mode) return;
        ready = true;
        window.clearTimeout(connectionTimer);
        startCapture();
        break;
      case "caption":
        if (typeof event.text !== "string" || !["dana", "you"].includes(event.role)) return;
        break;
      case "status":
        if (!["listening", "thinking", "speaking"].includes(event.state)) return;
        break;
      case "user_started_speaking":
        stopPlayback();
        break;
      case "error":
        fail("Dana’s relay reported a connection error.", event.fallback === "text");
        return;
      case "call_ended": {
        if (event.reason === "error") {
          fail("Dana’s relay ended unexpectedly.", true);
          return;
        }
        draining = true;
        stopMic();
        const drainMs = audio ? Math.max(0, playHead - audio.currentTime) * 1000 : 0;
        drainTimer = window.setTimeout(() => {
          release();
          onEvent(event);
        }, drainMs);
        return;
      }
      case "dana_done_speaking":
      case "checking":
        break;
      default:
        return;
    }
    onEvent(event);
  }

  async function open() {
    if (mode === "voice") {
      try {
        audio = new AudioContext();
        await audio.resume();
        if (closed) return;
        const input = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (closed) {
          input.getTracks().forEach(track => track.stop());
          return;
        }
        mic = input;
        await audio.audioWorklet.addModule("/dana-mic.js");
      } catch {
        fail("Microphone unavailable.", true);
        return;
      }
    }
    if (closed) return;
    const identity = session ?? { incidentId: "inc_demo", user: "dev", level: "explore" };
    socket = new WebSocket(danaUrl(base, { call: "briefing", mode, ...identity }));
    socket.binaryType = "arraybuffer";
    socket.onmessage = ({ data }: MessageEvent<string | ArrayBuffer>) => {
      if (closed || draining) return;
      try {
        if (typeof data === "string") handleEvent(JSON.parse(data));
        else if (ready && mode === "voice" && data instanceof ArrayBuffer) playChunk(data);
      } catch {
        fail("Dana sent an unreadable message.", true);
      }
    };
    socket.onclose = socket.onerror = () => fail("Dana’s relay disconnected.", true);
  }

  void open().catch(() => fail("Dana’s relay could not connect.", true));

  return {
    close: () => {
      send({ type: "hang_up" });
      release();
    },
    send,
  };
}
