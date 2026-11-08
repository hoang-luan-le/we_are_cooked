"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { NightCallView } from "../night-run";

const pad = (n: number) => String(n).padStart(2, "0");

function Icon({ d }: { d: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} fill="currentColor" /></svg>;
}
const handset = "M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1z";
const mic = "M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12z";
const chat = "M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-5 4V5a1 1 0 0 1 1-1z";

/** The fixture has one scripted briefing. It arrives a sentence at a time, the way live captions do. */
function useCaptions(view: NightCallView) {
  const { captions, mode } = view.briefing;
  const scripted = useMemo(() => mode === "fixture"
    ? captions.flatMap(caption => (caption.text.match(/[^.!?]+[.!?]+/g) ?? [caption.text]).map(text => ({ role: caption.role, text: text.trim() })))
    : [], [captions, mode]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (mode !== "fixture") return;
    const timer = window.setTimeout(() => setShown(n => Math.min(n + 1, scripted.length)), shown === 0 ? 1800 : 3200);
    return () => window.clearTimeout(timer);
  }, [mode, scripted.length, shown]);
  return mode === "fixture" ? scripted.slice(0, shown) : captions;
}

export function NightPhone({ view, held }: { view: NightCallView; held: boolean }) {
  const [live, setLive] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const accept = useRef<HTMLButtonElement>(null);
  const end = useRef<HTMLButtonElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const { briefing } = view;
  const active = view.stage === "briefing";
  const connected = briefing.mode === "fixture" || briefing.ready;
  const lines = useCaptions(view);
  const failed = briefing.state === "failed" || (active && briefing.mode === "text");
  const draining = briefing.state === "draining";

  useEffect(() => { if (held) (active ? end : accept).current?.focus({ preventScroll: true }); }, [held, active]);
  useEffect(() => {
    if (!active || !connected) return;
    const timer = window.setInterval(() => setSeconds(s => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [active, connected]);
  useEffect(() => { if (log.current) log.current.scrollTop = log.current.scrollHeight; }, [lines.length, live]);

  const status = <div className="phone-status" aria-hidden="true"><span>2:04</span><i className="phone-notch" /><span>5G</span></div>;
  const mute = briefing.mode === "voice" && briefing.ready ? (
    <button className="phone-round" aria-pressed={briefing.muted} onClick={briefing.toggleMute}><Icon d={mic} /><small>{briefing.muted ? "Unmute" : "Mute"}</small></button>
  ) : null;
  const hang = (
    <button ref={end} className="phone-round phone-red" disabled={draining} onClick={view.end} aria-label="End"><Icon d={handset} /><small>End</small></button>
  );
  const problems = (
    <>
      {view.error ? <p className="phone-note" role="alert">{view.error}</p> : null}
      {view.retry ? <button className="phone-pill" onClick={view.retry}>Try again</button> : null}
      {failed && active ? (
        <div className="phone-problem" role="alert">
          <p>{briefing.notice || "Voice is unavailable."}</p>
          {view.retryVoice ? <button className="phone-pill" onClick={view.retryVoice}>Retry voice</button> : null}
        </div>
      ) : null}
      {draining ? <div className="phone-problem"><button className="phone-pill" onClick={briefing.resumePlayback}>Resume audio</button><button className="phone-pill" onClick={briefing.skipPlayback}>Skip remaining audio</button></div> : null}
    </>
  );

  if (!active) {
    return (
      <section className="phone-screen phone-incoming" aria-label="Incoming call from Dana">
        {status}
        <div className="phone-who"><h1>Dana</h1><p>ShopNorth On-Call</p></div>
        <p className="phone-sub" role="status">{view.connecting ? "Connecting…" : view.snoozed ? "Snoozed. Dana will ring again." : "Incoming call"}</p>
        {problems}
        <div className="phone-answer">
          <button className="phone-round phone-red" disabled={!view.canSnooze} onClick={view.snooze}><Icon d={handset} /><small>Snooze</small></button>
          <button ref={accept} className="phone-round phone-green" disabled={!view.canAnswer} onClick={view.answer}><Icon d={handset} /><small>Accept</small></button>
        </div>
      </section>
    );
  }
  if (live) {
    return (
      <section className="phone-screen phone-live" aria-label="Live Conversation">
        {status}
        <header><button className="phone-link" onClick={() => setLive(false)}>Back to call</button><strong>Live Conversation</strong></header>
        <div className="phone-log" ref={log} role="log" aria-label="Dana captions" tabIndex={0}>
          {lines.length ? lines.map((line, index) => <p key={index} data-role={line.role}><b>{line.role === "dana" ? "Dana" : "You"}</b>{line.text}</p>) : <p className="phone-wait">Listening…</p>}
        </div>
        {problems}
        {briefing.mode === "fixture" ? <p className="phone-note">Scripted fixture. No live audio.</p> : null}
        <div className="phone-controls">{mute}{hang}</div>
      </section>
    );
  }
  return (
    <section className="phone-screen phone-active" aria-label="Call with Dana">
      {status}
      <div className="phone-who"><p className="phone-timer" role="timer">{connected ? `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}` : "Connecting…"}</p><h1>Dana</h1><p>ShopNorth On-Call</p></div>
      {problems}
      <div className="phone-controls">
        <button className="phone-round" onClick={() => setLive(true)}><Icon d={chat} /><small>Live Conversation</small></button>
        {mute}
        {hang}
      </div>
    </section>
  );
}
