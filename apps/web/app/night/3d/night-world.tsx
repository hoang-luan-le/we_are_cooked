"use client";

import { useMemo, useState } from "react";
import { bedroom } from "../../world/world-contract";
import { WorldShell } from "../../world/world-shell";
import { FixtureNight } from "../fixture-night";
import { NightRun, type NightStage } from "../night-run";

type RunProps = { apiUser?: string; relayBase?: string; incidentId?: string };

/** The bedroom around the existing Night flow. NightRun still owns all incident state and actions. */
export function NightWorld({ entryId, run, forceFallback }: { entryId?: string; run: RunProps; forceFallback?: boolean }) {
  const [stage, setStage] = useState<NightStage>();
  const availability = useMemo(() => ({
    ids: stage === "page" ? ["phone"] : stage === "board" ? ["computer"] : [],
    walk: stage === "board",
    ringing: stage === "page",
  }), [stage]);

  return (
    <WorldShell config={bedroom} availability={availability} alwaysShowPanel={stage !== "board"} forceFallback={forceFallback}>
      {entryId !== undefined
        ? <FixtureNight key={entryId} entryId={entryId} onStage={setStage} />
        : <NightRun key={run.incidentId ?? (run.apiUser ? "api" : "fixture")} {...run} onStage={setStage} />}
    </WorldShell>
  );
}
