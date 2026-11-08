"use client";

import { type FormEvent, type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { DanaCall, DanaMode, DanaServerMsg } from "../../../../packages/contracts/dana";
import { connectDana, type DanaConnection, type DanaTarget } from "./dana-connection";
import { BRIEFING, scriptedReply } from "./fixture";

type Caption = { role: "dana" | "you"; text: string };
type RelayState = "idle" | "connecting" | "listening" | "thinking" | "speaking" | "draining" | "ended" | "failed";
type DanaEngine = Extract<DanaServerMsg, { type: "ready" }>["engine"];

export function useDanaBriefing(resumeFixture = false) {
  const [mode, setMode] = useState<DanaMode | "fixture">("fixture");
  const [state, setState] = useState<RelayState>(resumeFixture ? "listening" : "idle");
  const [engine, setEngine] = useState<DanaEngine>();
  const [captions, setCaptions] = useState<Caption[]>(() => resumeFixture ? [{ role: "dana", text: BRIEFING }] : []);
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

  function useFixture(preserveCaptions = false) {
    close();
    setMode("fixture");
    setState("listening");
    setEngine(undefined);
    setNotice("");
    setCaptions(previous => [
      ...(preserveCaptions ? previous : []),
      { role: "dana", text: BRIEFING },
    ]);
  }

  return {
    mode, state, engine, captions, notice, muted, ready, canSend,
    close, sendText, startRelay, useFixture,
    isDraining: () => connection.current?.isDraining() ?? false,
    resumePlayback: () => connection.current?.resumePlayback(),
    skipPlayback: () => connection.current?.skipPlayback(),
    toggleMute: () => {
      if (connection.current?.send({ type: "mute", on: !muted })) setMuted(!muted);
    },
  };
}

const callLabels = {
  briefing: { title: "Dana’s briefing", action: "Continue to dashboard" },
  help: { title: "Dana help", action: "End help call" },
  debrief: { title: "Dana debrief", action: "End debrief call" },
} as const;

export function DanaBriefing({ heading, briefing, onContinue, call = "briefing" }: {
  heading: RefObject<HTMLHeadingElement | null>;
  briefing: ReturnType<typeof useDanaBriefing>;
  onContinue: () => void;
  call?: DanaCall;
}) {
  const labels = callLabels[call];
  const { mode, state, engine, captions, notice, muted, ready, canSend } = briefing;
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastAutoScroll = useRef(0);
  const engineLabel = engine === "deepgram" ? "Deepgram" : engine === "scripted" ? "Scripted (no AI)" : undefined;
  const status = mode === "fixture"
    ? "Offline briefing · Development fixture"
    : ["Dana relay", mode, engineLabel, state].filter(Boolean).join(" · ");

  useLayoutEffect(() => {
    if (!following.current || !log.current) return;
    log.current.scrollTop = log.current.scrollHeight;
    lastAutoScroll.current = log.current.scrollTop;
  }, [captions]);

  function sendText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (briefing.sendText(draft.trim())) setDraft("");
  }

  return (
    <section className="panel call-panel" aria-labelledby="dana-call-title">
      <p className="eyebrow">Dana call · ShopNorth</p>
      {call === "briefing" ? <h1 id="dana-call-title" ref={heading} tabIndex={-1}>{labels.title}</h1>
        : <h2 id="dana-call-title" ref={heading} tabIndex={-1}>{labels.title}</h2>}
      <p role="status" className="muted">{status}</p>
      {notice ? <p className="notice" role="alert">{notice}</p> : null}
      <div className="captions" ref={log} role="log" aria-label="Dana captions" tabIndex={0} onScroll={({ currentTarget }) => {
        const { scrollHeight, clientHeight, scrollTop } = currentTarget;
        const atBottom = scrollHeight - clientHeight - scrollTop <= 8;
        // A queued scroll event can arrive after more captions have increased the height.
        if (atBottom || scrollTop !== lastAutoScroll.current) following.current = atBottom;
      }}>
        {captions.length ? captions.map((caption, index) => (
          <p key={index}><strong>{caption.role === "dana" ? "Dana" : "You"}</strong> {caption.text}</p>
        )) : <p className="muted">Dana’s captions will appear here.</p>}
      </div>
      <form className="message-form" onSubmit={sendText}>
        <label>Message Dana
          <input maxLength={call === "debrief" ? 3000 : 500} autoComplete="off" value={draft} readOnly={state === "draining"} onChange={event => setDraft(event.target.value)} />
        </label>
        <button disabled={!canSend || !draft.trim()}>Send</button>
      </form>
      {(mode === "voice" && ready) || state === "failed" || state === "draining" ? (
        <div className="actions relay-actions">
          {mode === "voice" && ready ? (
            <button aria-pressed={muted} onClick={briefing.toggleMute}>{muted ? "Unmute mic" : "Mute mic"}</button>
          ) : null}
          {state === "failed" && call === "briefing" ? <button onClick={() => briefing.useFixture(true)}>Use offline briefing</button> : null}
          {state === "draining" ? <>
            <button onClick={briefing.resumePlayback}>Resume audio</button>
            <button onClick={briefing.skipPlayback}>Skip remaining audio</button>
          </> : null}
        </div>
      ) : null}
      <button className="primary" disabled={state === "draining"} onClick={onContinue}>{labels.action}</button>
    </section>
  );
}
