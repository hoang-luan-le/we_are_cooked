"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { mapHeading, type PanelId, type SceneConfig, toMinimap } from "./world-contract";
import type { DisplayContent } from "./world-display";
import type { PhoneState, WorldEngine, WorldMode, WorldPrompt } from "./world-engine";

export type Availability = { ids: string[]; walk: boolean; ringing: boolean };
export type Objective = { text: string; at?: readonly [number, number] };
type Pose = { u: number; v: number; heading: number };

const panelTitles: Record<PanelId, string> = {
  "incident-board": "Incident board", briefing: "Dana's briefing",
  "workstation-1": "Workstation 1", "workstation-2": "Workstation 2",
};

export function WorldShell({ config, availability, alwaysShowPanel, forceFallback, objective, displays, phone, skipWake, onPhoneSlot, onPhoneHeld, meeting, onPanelChange, onDoor, onFallbackChange, children }: {
  config: SceneConfig;
  availability: Availability;
  /** The 2D flow is the active step, for example the incoming call. */
  alwaysShowPanel: boolean;
  forceFallback?: boolean;
  objective?: Objective;
  /** Screens painted from app state, keyed by GLB mesh name. */
  displays?: Record<string, DisplayContent>;
  /** The handset's call state. Undefined outside the Night call. */
  phone?: PhoneState;
  /** Go straight to the handset in hand, without the wake-up. */
  skipWake?: boolean;
  onPhoneSlot?: (element: HTMLElement | null) => void;
  onPhoneHeld?: (held: boolean) => void;
  meeting?: { open: boolean; display: boolean; complete: boolean };
  onPanelChange?: (panel: PanelId | undefined) => void;
  onDoor?: (id: string, open: boolean) => void;
  onFallbackChange?: (fallback: boolean) => void;
  children: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [panel, setPanel] = useState<PanelId>();
  const [prompts, setPrompts] = useState<WorldPrompt[]>([]);
  const [mode, setMode] = useState<WorldMode>("loading");
  const [pose, setPose] = useState<Pose>();
  const [locked, setLocked] = useState(false);
  const [firstPerson, setFirstPerson] = useState(true);
  const [message, setMessage] = useState("");
  const [wake, setWake] = useState<"closed" | "open" | "done">("done");
  const [callBusy, setCallBusy] = useState(false);
  const slotRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef(skipWake);
  skipRef.current = skipWake;
  const heldHandler = useRef(onPhoneHeld);
  heldHandler.current = onPhoneHeld;
  const latest = useRef(availability);
  latest.current = availability;
  const latestDisplays = useRef(displays);
  latestDisplays.current = displays;
  const doorHandler = useRef(onDoor);
  doorHandler.current = onDoor;
  const fallback = Boolean(forceFallback || error);

  useEffect(() => { onFallbackChange?.(fallback); }, [fallback, onFallbackChange]);

  const openPanel = useCallback((next: PanelId) => {
    setPanel(next);
    onPanelChange?.(next);
    engineRef.current?.setPanelOpen(true);
  }, [onPanelChange]);

  const closePanel = useCallback(() => {
    setPanel(undefined);
    onPanelChange?.(undefined);
    engineRef.current?.setPanelOpen(false);
  }, [onPanelChange]);

  useEffect(() => {
    if (fallback || !canvas.current) return;
    let cancelled = false;
    let engine: WorldEngine | undefined;
    const element = canvas.current;
    void import("./world-engine").then(({ WorldEngine }) => {
      if (cancelled) return;
      try {
        engine = new WorldEngine(element, config, {
          onReady() {
            setReady(true);
            if (!panelRef.current?.contains(document.activeElement)) element.focus({ preventScroll: true });
            engine?.setAvailability(latest.current.ids, latest.current.walk, latest.current.ringing);
            for (const [mesh, content] of Object.entries(latestDisplays.current ?? {})) engine?.setDisplay(mesh, content);
          },
          onError: setError,
          onPrompts(next, nextMode) { setPrompts(next); setMode(nextMode); },
          onPose(x, z, fx, fz) { setPose({ ...toMinimap(x, z), heading: mapHeading(fx, fz) }); },
          onPanel: openPanel,
          onPhoneRect(rect) {
            const slot = slotRef.current;
            if (slot) {
              slot.hidden = !rect;
              if (rect) slot.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;--u:${rect.height / 844}px`;
            }
            heldHandler.current?.(Boolean(rect));
          },
          onCallBusy: setCallBusy,
          onDoor(id, open) { doorHandler.current?.(id, open); },
          onLock: setLocked,
          onMessage: setMessage,
          onView: setFirstPerson,
          onIntro: setWake,
        });
        engineRef.current = engine;
        if (new URLSearchParams(location.search).has("worldDebug")) Object.assign(window, { __world: engine });
      } catch {
        setError("This browser cannot show the 3D scene.");
      }
    }).catch(() => setError("The 3D scene could not be loaded."));
    return () => {
      cancelled = true;
      engine?.dispose();
      engineRef.current = null;
      setReady(false);
    };
  }, [config, fallback, openPanel]);

  useEffect(() => {
    engineRef.current?.setAvailability(availability.ids, availability.walk, availability.ringing);
  }, [availability]);

  useEffect(() => {
    if (ready && phone) engineRef.current?.setPhone(phone, Boolean(skipRef.current));
  }, [phone, ready]);

  const slotCallback = useCallback((element: HTMLDivElement | null) => {
    slotRef.current = element;
    onPhoneSlot?.(element);
  }, [onPhoneSlot]);

  useEffect(() => {
    for (const [mesh, content] of Object.entries(displays ?? {})) engineRef.current?.setDisplay(mesh, content);
  }, [displays, ready]);

  useEffect(() => {
    if (meeting && ready) engineRef.current?.setMeeting(meeting.open, meeting.display, meeting.complete);
  }, [meeting, ready]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 5000);
    return () => window.clearTimeout(timer);
  }, [message]);

  useEffect(() => {
    if (!panel) return;
    panelRef.current?.querySelector<HTMLElement>(".world-panel-close")?.focus({ preventScroll: true });
  }, [panel]);

  const showPanel = fallback || alwaysShowPanel || Boolean(panel);
  const full = fallback || Boolean(panel);
  const seated = mode === "seated";
  const movable = mode === "walk" || seated;

  return (
    <div className="world" data-fallback={fallback || undefined}>
      {fallback ? (
        <div className="world-still" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={config.still} alt={`Still view of the scene: ${config.title}`} />
          <p>{error ? `${error} Continue the exercise below.` : "Scene preview. Continue the exercise below."}</p>
        </div>
      ) : (
        <canvas ref={canvas} className="world-canvas" tabIndex={0}
          aria-label={`${config.title}. W A S D or arrow keys to move, E to interact, V to change view.`} />
      )}

      {!fallback ? (
        <>
          {!callBusy ? (
            <div className="world-topbar">
              <strong>{config.title}</strong>
            </div>
          ) : null}
          {!ready ? <p className="world-loading" role="status">Loading the 3D scene…</p> : null}
          {wake !== "done" ? <div className="world-eyelids" data-state={wake} aria-hidden="true"><b /><i /><i /></div> : null}
          {wake !== "done" ? <button className="world-skip" onClick={() => engineRef.current?.skipIntro()}>Skip wake-up</button> : null}

          {config.id === "office" && !panel ? <Minimap pose={pose} goal={objective?.at} /> : null}

          <div ref={slotCallback} className="world-phone" hidden />

          {!panel && ready && !callBusy ? (
            <div className="world-hud">
              {objective ? <p className="world-objective" role="status">{objective.text}</p> : null}
              {message ? <p className="world-message" role="status">{message}</p> : null}
              {mode === "walk" && !locked ? <p className="world-hint">Click the room to look around. W A S D to move, E to interact, scroll to zoom.</p> : null}
              {locked ? <p className="world-hint">Esc releases the mouse.</p> : null}
              <div className="world-actions">
                {prompts.slice(0, 3).map((prompt, index) => (
                  <button key={prompt.id} className={index === 0 ? "primary" : undefined} onClick={() => engineRef.current?.activate(prompt.id)}>
                    {index === 0 ? <kbd>E</kbd> : null} {prompt.label}
                  </button>
                ))}
                {seated ? <button className="primary" onClick={() => engineRef.current?.standUp()}><kbd>E</kbd> Stand up</button> : null}
                {seated && engineRef.current?.canReopenPanel ? <button onClick={() => engineRef.current?.reopenPanel()}>Open the panel again</button> : null}
              </div>
              <div className="world-actions">
                <button onClick={() => engineRef.current?.toggleView()}>{firstPerson ? "Switch to third person" : "Switch to first person"}</button>
                {movable && config.targets.some(target => target.kind === "seat" || target.kind === "panel") ? (
                  <details className="world-goto">
                    <summary>Go to without walking</summary>
                    <div className="world-actions">
                      {config.targets.filter(target => (target.kind === "seat" || target.kind === "panel") && target.id !== "projector" && availability.ids.includes(target.id)).map(target => (
                        <button key={target.id} onClick={() => engineRef.current?.goTo(target.id)}>{target.label}</button>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      <div ref={panelRef} className="world-panel" data-layout={full ? "full" : "side"} hidden={!showPanel}
        onKeyDown={event => { if (panel && event.key === "Escape" && !(event.target as HTMLElement).matches("input,textarea,select")) closePanel(); }}>
        {panel && !fallback ? (
          <div className="world-panel-bar">
            <strong>{panelTitles[panel]}</strong>
            <button className="world-panel-close" onClick={closePanel}>Back to the room</button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

function Minimap({ pose, goal }: { pose?: Pose; goal?: readonly [number, number] }) {
  const target = goal ? toMinimap(goal[0], goal[1]) : undefined;
  const lobby = toMinimap(7, 12);
  const end = toMinimap(-7, 0);
  const room = (x1: number, z1: number, x2: number, z2: number) => {
    const a = toMinimap(x1, z1), b = toMinimap(x2, z2);
    return { x: Math.min(a.u, b.u), y: Math.min(a.v, b.v), width: Math.abs(a.u - b.u), height: Math.abs(a.v - b.v) };
  };
  return (
    <svg className="world-minimap" viewBox="0 30 180 165" role="img" aria-label="Floor plan. North is the direction you walk in from the entrance.">
      <rect x={lobby.u} y={lobby.v} width={end.u - lobby.u} height={end.v - lobby.v} className="map-floor" />
      <rect {...room(-7, 0, 7, -4.5)} className="map-plaza" />
      <rect {...room(-7, 12, -2, 5.5)} className="map-room" />
      <rect {...room(2, 12, 7, 5.5)} className="map-room" />
      <text x="122" y="88" className="map-label">Dana</text>
      <text x="38" y="88" className="map-label">Desks</text>
      <text x="90" y="150" className="map-label" textAnchor="middle">Lobby</text>
      {target ? <circle cx={target.u} cy={target.v} r="5" className="map-goal" data-testid="map-goal"
        data-u={target.u.toFixed(1)} data-v={target.v.toFixed(1)} /> : null}
      {pose ? <path d="M0 -8 L5.5 6 L0 3 L-5.5 6 Z" className="map-player" data-testid="map-player"
        data-u={pose.u.toFixed(1)} data-v={pose.v.toFixed(1)} data-heading={pose.heading.toFixed(0)}
        transform={`translate(${pose.u} ${pose.v}) rotate(${pose.heading})`} /> : null}
    </svg>
  );
}
