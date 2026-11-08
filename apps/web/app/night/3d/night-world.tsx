"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { bedroom } from "../../world/world-contract";
import type { DisplayContent } from "../../world/world-display";
import { type Objective, WorldShell } from "../../world/world-shell";
import { FixtureNight } from "../fixture-night";
import { type NightCallView, NightRun, type NightStage } from "../night-run";
import { NightPhone } from "./night-phone";

type RunProps = { apiUser?: string; relayBase?: string; incidentId?: string };
const props = ["lamp", "desk-lamp", "blinds", "clock", "bed"];

/** The bedroom around the existing Night flow. NightRun still owns all incident state and actions. */
export function NightWorld({ entryId, run, forceFallback }: { entryId?: string; run: RunProps; forceFallback?: boolean }) {
  const [stage, setStage] = useState<NightStage>();
  const [noIntro, setNoIntro] = useState(true);
  const [fallback, setFallback] = useState(Boolean(forceFallback));
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [held, setHeld] = useState(false);
  const [snoozed, setSnoozed] = useState(false);
  useEffect(() => { setNoIntro(new URLSearchParams(location.search).has("noIntro")); }, []);
  const availability = useMemo(() => ({
    ids: stage === "board" ? ["computer", ...props] : [],
    walk: stage === "board",
    ringing: stage === "page",
  }), [stage]);
  const objective: Objective | undefined = stage === "board" ? { text: "Go to the computer and open the incident board." } : undefined;
  const displays = useMemo<Record<string, DisplayContent>>(() => ({
    Custom_Monitor_Display_Surface: {
      eyebrow: "ShopNorth on-call", badge: run.apiUser ? "Local API" : "Fixture", dark: true,
      title: stage === "board" ? "Incident board ready" : "Checkout alert",
      lines: [stage === "board" ? "Sit down to open metrics, logs and deploys." : "Answer Dana first."],
    },
  }), [stage, run.apiUser]);
  const renderCall = useCallback((call: NightCallView): ReactNode => {
    queueMicrotask(() => setSnoozed(call.snoozed));
    return slot ? createPortal(<NightPhone view={call} held={held} />, slot) : null;
  }, [slot, held]);
  const phone = stage === undefined ? undefined : stage === "board" ? "none" as const : stage === "briefing" ? "active" as const : snoozed ? "snoozed" as const : "ringing" as const;
  const presentation = fallback ? undefined : renderCall;

  return (
    <WorldShell config={bedroom} availability={availability} alwaysShowPanel={false} forceFallback={forceFallback} objective={objective} displays={displays}
      phone={fallback ? undefined : phone} skipWake={noIntro} onPhoneSlot={setSlot} onPhoneHeld={setHeld} onFallbackChange={setFallback}>
      {entryId !== undefined
        ? <FixtureNight key={entryId} entryId={entryId} onStage={setStage} renderCall={presentation} />
        : <NightRun key={run.incidentId ?? (run.apiUser ? "api" : "fixture")} {...run} onStage={setStage} renderCall={presentation} />}
    </WorldShell>
  );
}
