// Dana voice WebSocket contract. See dana-voice.md. DRAFT: change only via PR (AI + Frontend + Backend).

export type DanaCall = "briefing" | "help" | "debrief";
export type Level = "explore" | "practice" | "challenge";
export type DanaMode = "voice" | "text";

// Audio: binary frames, PCM16 LE, mono. Mic in at 16 kHz, Dana out at 24 kHz.
export const DANA_INPUT_RATE = 16000;
export const DANA_OUTPUT_RATE = 24000;

export function danaUrl(apiWsBase: string, p: {
  call: DanaCall; incidentId: string; user: string; level: Level; mode: DanaMode;
}): string {
  const q = new URLSearchParams({
    call: p.call, incident_id: p.incidentId, user: p.user, level: p.level, mode: p.mode,
  });
  return `${apiWsBase}/ws/voice?${q.toString()}`;
}

// server -> browser
export type DanaServerMsg =
  | { type: "ready"; call: DanaCall; mode: DanaMode; engine: "deepgram" | "scripted" }
  | { type: "caption"; role: "dana" | "you"; text: string }
  | { type: "status"; state: "listening" | "thinking" | "speaking" }
  | { type: "user_started_speaking" }
  | { type: "dana_done_speaking" }
  | { type: "checking"; what: string }
  | { type: "call_ended"; reason: "done" | "user_hung_up" | "error" }
  | { type: "error"; code: string; message: string; fallback: "text" | "none" };

// browser -> server
export type DanaClientMsg =
  | { type: "text"; text: string }
  | { type: "mute"; on: boolean }
  | { type: "hang_up" };
