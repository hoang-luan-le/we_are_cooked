"use client";

import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import type { DanaMode, Level } from "../../../../packages/contracts/dana";
import { connectDana, type DanaConnection } from "./dana-connection";
import { BRIEFING, scriptedReply } from "./fixture";

type Caption = { role: "dana" | "you"; text: string };
type RelayState = "connecting" | "listening" | "thinking" | "speaking" | "ended" | "failed";

export function DanaBriefing({ heading, relayBase, session, onContinue }: {
  heading: RefObject<HTMLHeadingElement | null>;
  relayBase?: string;
  session?: { incidentId: string; user: string; level: Level };
  onContinue: () => void;
}) {
  const [mode, setMode] = useState<DanaMode | "fixture">("fixture");
  const [state, setState] = useState<RelayState>("ended");
  const [captions, setCaptions] = useState<Caption[]>([{ role: "dana", text: BRIEFING }]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [muted, setMuted] = useState(false);
  const connection = useRef<DanaConnection>(null);
  const ready = state === "listening" || state === "thinking" || state === "speaking";
  const canSend = mode === "fixture" || ready;

  useEffect(() => () => connection.current?.close(), []);

  function startRelay(nextMode: DanaMode, fallbackNotice = "") {
    if (!relayBase) return;
    connection.current?.close();
    setMode(nextMode);
    setState("connecting");
    setMuted(false);
    setNotice(fallbackNotice);
    if (!fallbackNotice) setCaptions([]);

    connection.current = connectDana({
      base: relayBase,
      mode: nextMode,
      session,
      onEvent: event => {
        if (event.type === "ready") setState("listening");
        if (event.type === "status") setState(event.state);
        if (event.type === "caption") setCaptions(previous => [...previous, event]);
        if (event.type === "call_ended") setState("ended");
      },
      onFailure: (message, allowText) => {
        if (nextMode === "voice" && allowText) {
          startRelay("text", `${message} Switching to text.`);
        } else {
          setState("failed");
          setNotice(message);
        }
      },
    });
  }

  function sendText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !canSend) return;
    if (mode === "fixture") {
      setCaptions(previous => [...previous, { role: "you", text }, { role: "dana", text: scriptedReply(text) }]);
    } else if (!connection.current?.send({ type: "text", text })) {
      setNotice("The relay is unavailable. Your message is still here.");
      return;
    }
    setDraft("");
  }

  function useFixture() {
    connection.current?.close();
    setMode("fixture");
    setState("ended");
    setNotice("");
    setCaptions([{ role: "dana", text: BRIEFING }]);
  }

  return (
    <section className="panel call-panel" aria-labelledby="briefing-title">
      <p className="eyebrow">Call briefing · ShopNorth</p>
      <h1 id="briefing-title" ref={heading} tabIndex={-1}>Dana’s briefing</h1>
      <p role="status" className="muted">{mode === "fixture" ? "Scripted text · Development fixture" : `Development relay · ${mode} · ${state}`}</p>
      {notice ? <p className="notice" role="alert">{notice}</p> : null}
      <div className="captions" role="log" aria-label="Dana captions">
        {captions.length ? captions.map((caption, index) => (
          <p key={index}><strong>{caption.role === "dana" ? "Dana" : "You"}</strong> {caption.text}</p>
        )) : <p className="muted">Dana’s captions will appear here.</p>}
      </div>
      <form className="message-form" onSubmit={sendText}>
        <label>Message Dana
          <input maxLength={500} autoComplete="off" value={draft} disabled={!canSend} onChange={event => setDraft(event.target.value)} />
        </label>
        <button disabled={!canSend || !draft.trim()}>Send</button>
      </form>
      {relayBase ? (
        <div className="actions relay-actions">
          <button disabled={mode === "voice" && (ready || state === "connecting")} onClick={() => startRelay("voice")}>Use relay voice</button>
          <button disabled={mode === "text" && (ready || state === "connecting")} onClick={() => startRelay("text")}>Use relay text</button>
          {mode === "voice" && ready ? (
            <button aria-pressed={muted} onClick={() => {
              if (connection.current?.send({ type: "mute", on: !muted })) setMuted(!muted);
            }}>{muted ? "Unmute mic" : "Mute mic"}</button>
          ) : null}
          {mode !== "fixture" ? <button onClick={useFixture}>Use scripted briefing</button> : null}
        </div>
      ) : null}
      <button className="primary" onClick={onContinue}>Continue to dashboard <span aria-hidden="true">→</span></button>
    </section>
  );
}
