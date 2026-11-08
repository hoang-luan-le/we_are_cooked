"use client";

import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { DanaMode, DanaServerMsg } from "../../../../packages/contracts/dana";
import { connectDana, type DanaConnection, type DanaTarget } from "./dana-connection";
import { BRIEFING, scriptedReply } from "./fixture";

type Caption = { role: "dana" | "you"; text: string };
type RelayState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "draining" | "ended" | "failed";
type DanaEngine = Extract<DanaServerMsg, { type: "ready" }>["engine"];

export function useDanaBriefing() {
  const [mode, setMode] = useState<DanaMode | "fixture">("fixture");
  const [state, setState] = useState<RelayState>("idle");
  const [engine, setEngine] = useState<DanaEngine>();
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [notice, setNotice] = useState("");
  const [muted, setMuted] = useState(false);
  const connection = useRef<DanaConnection>(null);
  const ready = state === "listening" || state === "thinking" || state === "speaking";
  const canSend = mode === "fixture" || ready;

  const close = useCallback(() => {
    connection.current?.close();
    connection.current = null;
  }, []);

  useEffect(() => close, [close]);

  function startRelay(target: DanaTarget, fallbackNotice = "") {
    close();
    setMode(target.mode);
    setState("connecting");
    setEngine(undefined);
    setMuted(false);
    setNotice(fallbackNotice);
    if (!fallbackNotice) setCaptions([]);

    connection.current = connectDana({
      ...target,
      onEvent: event => {
        if (event.type === "ready") {
          setEngine(event.engine);
          setState("listening");
        }
        if (event.type === "status") setState(event.state);
        if (event.type === "caption") setCaptions(previous => [...previous, event]);
        if (event.type === "call_ended") setState("ended");
      },
      onDrain: () => setState("draining"),
      onFailure: (message, allowText) => {
        if (target.mode === "voice" && allowText) {
          startRelay({ ...target, mode: "text", audio: undefined }, `${message} Switching to text.`);
        } else {
          setState("failed");
          setNotice(message);
        }
      },
    });
  }

  function sendText(text: string) {
    if (!text || !canSend) return false;
    if (mode === "fixture") {
      setCaptions(previous => [...previous, { role: "you", text }, { role: "dana", text: scriptedReply(text) }]);
    } else if (!connection.current?.send({ type: "text", text })) {
      setNotice("The relay is unavailable. Your message is still here.");
      return false;
    }
    return true;
  }

  function useFixture() {
    close();
    setMode("fixture");
    setState("listening");
    setEngine(undefined);
    setNotice("");
    setCaptions([{ role: "dana", text: BRIEFING }]);
  }

  return {
    mode, state, engine, captions, notice, muted, ready, canSend,
    close, sendText, startRelay, useFixture,
    isDraining: () => connection.current?.isDraining() ?? false,
    resumePlayback: () => connection.current?.resumePlayback(),
    toggleMute: () => {
      if (connection.current?.send({ type: "mute", on: !muted })) setMuted(!muted);
    },
  };
}

export function DanaBriefing({ heading, briefing, onContinue }: {
  heading: RefObject<HTMLHeadingElement | null>;
  briefing: ReturnType<typeof useDanaBriefing>;
  onContinue: () => void;
}) {
  const { mode, state, engine, captions, notice, muted, ready, canSend } = briefing;
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const engineLabel = engine === "deepgram" ? "Deepgram" : engine === "scripted" ? "Scripted (no AI)" : undefined;
  const status = mode === "fixture"
    ? "Offline briefing · Development fixture"
    : ["Dana relay", mode, engineLabel, state].filter(Boolean).join(" · ");

  useEffect(() => {
    if (following.current && log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [captions]);

  function sendText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (briefing.sendText(draft.trim())) setDraft("");
  }

  return (
    <section className="panel call-panel" aria-labelledby="briefing-title">
      <p className="eyebrow">Call briefing · ShopNorth</p>
      <h1 id="briefing-title" ref={heading} tabIndex={-1}>Dana’s briefing</h1>
      <p role="status" className="muted">{status}</p>
      {notice ? <p className="notice" role="alert">{notice}</p> : null}
      <div className="captions" ref={log} role="log" aria-label="Dana captions" onScroll={({ currentTarget }) => {
        following.current = currentTarget.scrollHeight - currentTarget.clientHeight - currentTarget.scrollTop <= 8;
      }}>
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
      {(mode === "voice" && ready) || state === "failed" || state === "draining" ? (
        <div className="actions relay-actions">
          {mode === "voice" && ready ? (
            <button aria-pressed={muted} onClick={briefing.toggleMute}>{muted ? "Unmute mic" : "Mute mic"}</button>
          ) : null}
          {state === "failed" ? <button onClick={briefing.useFixture}>Use offline briefing</button> : null}
          {state === "draining" ? <button onClick={briefing.resumePlayback}>Resume audio</button> : null}
        </div>
      ) : null}
      <button className="primary" disabled={state === "draining"} onClick={onContinue}>Continue to dashboard <span aria-hidden="true">→</span></button>
    </section>
  );
}
