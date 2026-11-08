"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { mapHeading, type PanelId, type SceneConfig, toMinimap } from "./world-contract";
import type { WorldEngine, WorldMode, WorldPrompt } from "./world-engine";

export type Availability = { ids: string[]; walk: boolean; ringing: boolean };
type Pose = { u: number; v: number; heading: number };

const panelTitles: Record<PanelId, string> = {
  "incident-board": "Incident board", briefing: "Dana's briefing",
  "workstation-1": "Workstation 1", "workstation-2": "Workstation 2",
};
const objectives = [
  { text: "Go inside through the entrance doors", at: [0, 0] },
  { text: "Join Dana's briefing in the meeting room", at: [-2, 7.8] },
  { text: "Go to your workstation", at: [4.5, 9.2] },
] as const;

export function WorldShell({ config, availability, alwaysShowPanel, forceFallback, onPanelChange, children }: {
  config: SceneConfig;
  availability: Availability;
  /** The 2D flow is the active step, for example the incoming call. */
  alwaysShowPanel: boolean;
  forceFallback?: boolean;
  onPanelChange?: (panel: PanelId | undefined) => void;
  children: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine>(null);
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [view2d, setView2d] = useState(Boolean(forceFallback));
  const [panel, setPanel] = useState<PanelId>();
  const [prompts, setPrompts] = useState<WorldPrompt[]>([]);
  const [mode, setMode] = useState<WorldMode>("loading");
  const [pose, setPose] = useState<Pose>();
  const [locked, setLocked] = useState(false);
  const [objective, setObjective] = useState(0);
  const latest = useRef(availability);
  latest.current = availability;
  const panelOpen = useRef<PanelId>(undefined);
  const fallback = view2d || Boolean(error);

  const openPanel = useCallback((next: PanelId) => {
    panelOpen.current = next;
    setPanel(next);
    onPanelChange?.(next);
    if (next === "briefing") setObjective(current => Math.max(current, 2));
    engineRef.current?.setPanelOpen(true);
  }, [onPanelChange]);

  const closePanel = useCallback(() => {
    panelOpen.current = undefined;
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
            element.focus({ preventScroll: true });
            engine?.setAvailability(latest.current.ids, latest.current.walk, latest.current.ringing);
          },
          onError: setError,
          onPrompts(next, nextMode) { setPrompts(next); setMode(nextMode); },
          onPose(x, z, fx, fz) { setPose({ ...toMinimap(x, z), heading: mapHeading(fx, fz) }); },
          onPanel: openPanel,
          onPhone() { panelRef.current?.querySelector<HTMLElement>(".call-panel button:not(:disabled)")?.focus(); },
          onDoor(id, open) { if (open && id.startsWith("office_entrance")) setObjective(current => Math.max(current, 1)); },
          onLock: setLocked,
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
    if (!panel) return;
    const root = panelRef.current;
    if (!root) return;
    if (panel === "briefing") root.querySelector('[aria-label="Night shift handoff"]')?.scrollIntoView({ block: "start" });
    root.querySelector<HTMLElement>(".world-panel-close")?.focus({ preventScroll: true });
  }, [panel]);

  const showPanel = fallback || alwaysShowPanel || Boolean(panel);
  const full = fallback || Boolean(panel);
  const seated = mode === "seated";
  const seatPanelLabel = "Open the panel again";

  return (
    <div className="world" data-fallback={fallback || undefined}>
      {fallback ? (
        <div className="world-still" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={config.still} alt={`Still view of the scene: ${config.title}`} />
          <p>{error ? `${error} The full 2D workflow is below.` : "2D view. The full workflow is below."}</p>
          {!error && !forceFallback ? <button onClick={() => setView2d(false)}>Return to 3D</button> : null}
        </div>
      ) : (
        <canvas ref={canvas} className="world-canvas" tabIndex={0}
          aria-label={`${config.title}. Use W A S D or arrow keys to move, E to interact.`} />
      )}

      {!fallback ? (
        <>
          <div className="world-topbar">
            <strong>{config.title}</strong>
            <button onClick={() => setView2d(true)}>Use 2D view</button>
          </div>
          {!ready ? <p className="world-loading" role="status">Loading the 3D scene…</p> : null}

          {config.id === "office" && !panel ? <Minimap pose={pose} objective={objective} /> : null}

          {!panel && ready ? (
            <div className="world-hud">
              {config.id === "office" ? <p className="world-objective" role="status">{objectives[objective].text}</p> : null}
              {mode === "walk" && !locked ? <p className="world-hint">Click the room to look around. W A S D to move, E to interact.</p> : null}
              {locked ? <p className="world-hint">Esc releases the mouse.</p> : null}
              <div className="world-actions">
                {prompts.map((prompt, index) => (
                  <button key={prompt.id} className={index === 0 ? "primary" : undefined} onClick={() => engineRef.current?.activate(prompt.id)}>
                    {index === 0 ? <kbd>E</kbd> : null} {prompt.label}
                  </button>
                ))}
                {seated ? <button className="primary" onClick={() => engineRef.current?.standUp()}><kbd>E</kbd> Stand up</button> : null}
                {seated ? <button onClick={() => engineRef.current?.reopenPanel()}>{seatPanelLabel}</button> : null}
              </div>
              {(mode === "walk" || seated) && config.targets.some(target => target.kind !== "door" && target.kind !== "phone") ? (
                <details className="world-goto">
                  <summary>Go to without walking</summary>
                  <div className="world-actions">
                    {config.targets.filter(target => target.kind !== "door" && target.kind !== "phone" && availability.ids.includes(target.id)).map(target => (
                      <button key={target.id} onClick={() => engineRef.current?.goTo(target.id)}>{target.label}</button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}

      <div ref={panelRef} className="world-panel" data-layout={full ? "full" : "side"} hidden={!showPanel}
        onKeyDown={event => { if (panel && event.key === "Escape" && !(event.target as HTMLElement).matches("input,textarea,select")) closePanel(); }}
        onClickCapture={event => {
          const link = (event.target as HTMLElement).closest?.("a");
          const href = link?.getAttribute("href");
          if (!fallback && href?.startsWith("/morning?")) {
            event.preventDefault();
            router.push(href.replace("/morning?", "/morning/3d?"));
          }
        }}>
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

function Minimap({ pose, objective }: { pose?: Pose; objective: number }) {
  const goal = toMinimap(objectives[objective].at[0], objectives[objective].at[1]);
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
      <circle cx={goal.u} cy={goal.v} r="5" className="map-goal" data-testid="map-goal" />
      {pose ? <path d="M0 -8 L5.5 6 L0 3 L-5.5 6 Z" className="map-player" data-testid="map-player"
        data-u={pose.u.toFixed(1)} data-v={pose.v.toFixed(1)} data-heading={pose.heading.toFixed(0)}
        transform={`translate(${pose.u} ${pose.v}) rotate(${pose.heading})`} /> : null}
    </svg>
  );
}
