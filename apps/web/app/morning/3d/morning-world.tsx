"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { office, type PanelId } from "../../world/world-contract";
import { WorldShell } from "../../world/world-shell";
import { MorningWorkspace } from "../morning-workspace";

type Team = { incidentId: string; user: string; relayBase: string; rehearsalGitHub: boolean };
const every = { ids: office.targets.map(target => target.id), walk: true, ringing: false };

/** The office around the existing Morning workspace. Each desk opens that same workspace. */
export function MorningWorld({ team, forceFallback }: { team?: Team; forceFallback?: boolean }) {
  const [panel, setPanel] = useState<PanelId>();
  const availability = useMemo(() => every, []);
  return (
    <WorldShell config={office} availability={availability} alwaysShowPanel={false} forceFallback={forceFallback} onPanelChange={setPanel}>
      {team ? <MorningWorkspace key={team.incidentId} {...team} /> : (
        <main className="workspace">
          <span className="badge fixture">Development fixture</span>
          <h1>{panel ? `Opened: ${panel}` : "Morning workspace"}</h1>
          <p>This walkthrough has no incident attached. A team incident shows the shared Morning workspace here.</p>
          <Link href="/start">Back to simulation entry</Link>
        </main>
      )}
    </WorldShell>
  );
}
