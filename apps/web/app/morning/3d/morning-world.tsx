"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { PullRequestInfo } from "../../../../../packages/contracts/types";
import { useNightApi } from "../../night/use-night-api";
import { office, type PanelId } from "../../world/world-contract";
import type { DisplayContent } from "../../world/world-display";
import { type Objective, WorldShell } from "../../world/world-shell";
import { fixtureInput, fixturePr, liveInput, loadProgress, prStatusLines, saveProgress, useMeetingEvidence } from "../meeting/meeting-data";
import { MeetingPanel } from "../meeting/meeting-panel";
import { type Assignment, authorFixture, beatDisplay, buildBeats, reviewerFixture } from "../meeting/meeting-script";
import { MorningWorkspace } from "../morning-workspace";
import type { Pilot } from "../pilot";

type Team = { incidentId: string; user: string; relayBase: string; rehearsalGitHub: boolean; pilot?: Pilot };
export type FixtureOptions = { role?: string; evidence?: string; handoff?: string; pr?: string };
const every = { ids: office.targets.map(target => target.id), walk: true, ringing: false };
const deskMesh = { "desk-1": "Custom_WS1_PR_Review_Screen", "desk-2": "WS2_Laptop_Screen" } as const;
const panelDesk = { "workstation-1": "desk-1", "workstation-2": "desk-2" } as const;

/** The office around the existing Morning workspace, with the incident review before it. */
export function MorningWorld({ team, forceFallback, fixture, handoffs }: {
  team?: Team; forceFallback?: boolean; fixture?: FixtureOptions; handoffs?: ReactNode;
}) {
  const [panel, setPanel] = useState<PanelId>();
  const [fallback, setFallback] = useState(Boolean(forceFallback));
  const [entered, setEntered] = useState(false);
  const api = useNightApi(Boolean(team), team?.incidentId);
  const incident = api.snapshot?.incident;
  const evidence = useMeetingEvidence(team?.incidentId, Boolean(incident?.handoff));

  // Only labeled fixtures carry a role. The API has a list of names, which grants nothing.
  const assignment: Assignment | null = !team && fixture?.role === "author" ? authorFixture : !team && fixture?.role === "reviewer" ? reviewerFixture : null;
  const input = useMemo(() => handoffs ? null : team
    ? incident ? liveInput(incident, evidence) : null
    : fixtureInput({ evidenceMissing: fixture?.evidence === "missing", handoffMissing: fixture?.handoff === "missing" }),
  [handoffs, team, incident, evidence, fixture?.evidence, fixture?.handoff]);
  const beats = useMemo(() => input ? buildBeats(input, assignment) : [], [input, assignment]);
  const pr: PullRequestInfo | null | undefined = team ? incident?.pr : fixturePr(fixture?.pr);

  const run = team ? `${team.user}.${team.incidentId}` : `fixture.${fixture?.role ?? "none"}.${fixture?.evidence ?? "all"}.${fixture?.handoff ?? "all"}`;
  const [progress, setProgress] = useState({ index: 0, complete: false });
  useEffect(() => { setProgress(loadProgress(run)); }, [run]);
  const update = useCallback((next: { index: number; complete: boolean }) => { setProgress(next); saveProgress(run, next); }, [run]);

  const source = input?.source ?? "Local API";
  const beat = beats[Math.min(progress.index, beats.length - 1)];
  const displays = useMemo(() => {
    const out: Record<string, DisplayContent> = {};
    if (beat) out.Custom_Meeting_Shared_Screen = beatDisplay(beat, progress.index, beats.length, source);
    if (handoffs) out.Custom_Meeting_Shared_Screen = {
      eyebrow: "Morning shift", title: "Your incident handoffs", lines: ["Open the briefing to choose an incident."], badge: source,
    };
    for (const desk of ["desk-1", "desk-2"] as const) {
      const yours = assignment?.desk === desk;
      const other = assignment && !yours;
      out[deskMesh[desk]] = {
        eyebrow: desk === "desk-1" ? "Workstation 1" : "Workstation 2",
        title: yours ? `${assignment.role}: permanent fix` : other ? "Assigned to your teammate" : "Morning workspace",
        lines: other ? [`Your desk is ${assignment.workstation}.`] : prStatusLines(pr),
        badge: source, dark: true,
      };
    }
    return out;
  }, [beat, progress.index, beats.length, source, assignment, pr, handoffs]);

  const objective: Objective = !entered && !progress.complete ? { text: "Go inside through the entrance doors", at: [0, 0] }
    : !progress.complete ? { text: "Join Dana's briefing in the meeting room", at: [-2, 7.43] }
    : assignment ? { text: `Go to ${assignment.workstation} for your ${assignment.role} task`, at: assignment.at }
    : { text: "Go to a workstation and open the Morning workspace", at: [2, 7.43] };

  const onDoor = useCallback((id: string, open: boolean) => { if (open && id.startsWith("office_entrance")) setEntered(true); }, []);
  const meetingState = useMemo(() => ({ open: panel === "briefing", display: progress.index % 2 === 1, complete: progress.complete }), [panel, progress.index, progress.complete]);
  const desk = panel === "workstation-1" || panel === "workstation-2" ? panelDesk[panel] : undefined;
  const showMeeting = panel === "briefing" || fallback;
  const showDesk = Boolean(desk) || fallback;

  return (
    <WorldShell config={office} availability={every} alwaysShowPanel={false} forceFallback={forceFallback} objective={objective}
      displays={displays} meeting={meetingState} onPanelChange={setPanel} onDoor={onDoor} onFallbackChange={setFallback}>
      <div hidden={!showMeeting}>
        {handoffs ?? (beat ? <MeetingPanel beats={beats} index={progress.index} source={source} complete={progress.complete}
          onIndex={index => update({ ...progress, index })}
          onFinish={() => {
            update({ ...progress, complete: true });
            document.querySelector<HTMLElement>(".world-panel-close")?.click();
          }} /> : <main className="meeting"><p role="status">Loading the incident review…</p></main>)}
      </div>
      <div hidden={!showDesk}>
        <DeskTask assignment={assignment} desk={desk} pr={pr} />
        {team ? <MorningWorkspace key={team.incidentId} {...team} /> : (
          <main className="workspace">
            <span className="badge fixture">Development fixture</span>
            <h1>Morning workspace</h1>
            <p>This walkthrough has no incident attached. A team incident shows the shared Morning workspace here.</p>
            <Link href="/start">Back to simulation entry</Link>
          </main>
        )}
      </div>
    </WorldShell>
  );
}

function DeskTask({ assignment, desk, pr }: { assignment: Assignment | null; desk?: "desk-1" | "desk-2"; pr: PullRequestInfo | null | undefined }) {
  const wrongDesk = assignment && desk && assignment.desk !== desk;
  return (
    <section className="desk-task panel" aria-label="Your Morning task">
      {assignment ? <p><span className="badge fixture">{assignment.source}</span></p> : null}
      <h2>{assignment ? `${assignment.role} task` : "Permanent fix"}</h2>
      {wrongDesk ? <p className="notice" role="status">This desk is for your teammate. Your desk is {assignment.workstation}.</p> : null}
      <p>{assignment?.task ?? "Your role isn't assigned in the current data. The Morning workspace shows what your account can do."}</p>
      <p>Write and test code in VS Code. Open or review the pull request on GitHub.</p>
      {assignment ? <ul>{assignment.checks.map(check => <li key={check}>{check}</li>)}</ul> : null}
      <ul aria-label="Pull request status">{prStatusLines(pr).map(line => <li key={line}>{line}</li>)}</ul>
      {pr ? <a href={pr.url} target="_blank" rel="noreferrer">Open pull request on GitHub</a> : <p className="muted">No issue or repository link is available from this data.</p>}
    </section>
  );
}
