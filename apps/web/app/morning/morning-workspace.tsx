"use client";

import Link from "next/link";
import { teamIncidentHref } from "../night/team-entry-contract";
import { useNightApi } from "../night/use-night-api";
import { IncidentCheck } from "./incident-check";
import { Connections, MorningDebrief, PrivateEvidence } from "./morning-after";
import { HandoffReview, MorningReview } from "./morning-review";

export function MorningWorkspace({ incidentId, user, relayBase, rehearsalGitHub }: {
  incidentId: string; user: string; relayBase: string; rehearsalGitHub: boolean;
}) {
  const api = useNightApi(true, incidentId);
  const incident = api.snapshot?.incident;
  const unavailable = api.pending || api.readError;
  const fixed = incident?.status === "fixed" && (incident.phase === "fixed" || incident.phase === "debriefed");

  return (
    <>
      <header className="app-header">
        <Link href="/start">Incident Lab</Link><span className="badge fixture">Local team API</span>
      </header>
      <main className="workspace">
        <section className="board-heading">
          <p className="eyebrow">Morning 2D · ShopNorth</p>
          <h1>Fix the checkout regression</h1>
          {incident ? <p>Reviewing incident {incidentId} as {user}.</p> : null}
          {api.snapshot ? <p>Last incident response <time dateTime={new Date(api.snapshot.receivedAt).toISOString()}>
            {new Date(api.snapshot.receivedAt).toLocaleTimeString()}
          </time></p> : null}
          {rehearsalGitHub ? <p><span className="badge fixture">Rehearsal GitHub fixture</span></p> : null}
          <Link href={teamIncidentHref(incidentId)}>Back to Night board</Link>
        </section>
        {api.readError || api.actionError ? <div className="notice action-notice">
          <p role="alert">{api.accessLost ? "This incident is unavailable to this demo member."
            : api.actionError || (incident ? "Incident refresh failed. Showing the last update." : "The incident could not be loaded.")}</p>
          <div className="actions">
            <button onClick={api.refresh}>Refresh incident</button>
            {api.retryAction?.action === "deploy_fix" && incident?.pr?.substantive_review ? <button disabled={unavailable} onClick={() => void api.act({ action: "deploy_fix" })}>Retry deploy confirmation</button> : null}
          </div>
        </div> : null}
        {!incident && !api.readError ? <p role="status">Loading Morning workspace…</p> : null}
        {incident && !incident.handoff ? <section className="panel phase-panel">
          <h2>Waiting for the Night handoff</h2>
          <p>Continue once the Night team has recorded recovery and their notes for Morning.</p>
        </section> : null}
        {incident?.handoff ? <div className="phase-grid">
          <HandoffReview incident={incidentId} handoff={incident.handoff} user={user} unavailable={unavailable} onChange={api.refresh} />
          <IncidentCheck incident={incidentId} fixed={fixed} unavailable={unavailable} />
          <MorningReview incident={incident} unavailable={unavailable} onChange={api.refresh} onDeploy={() => api.act({ action: "deploy_fix" })} />
          {fixed ? <>
            <MorningDebrief incident={incident} user={user} relayBase={relayBase} unavailable={unavailable} refresh={api.refresh} />
            <PrivateEvidence incident={incident} />
            {incident.rubric?.final ? <Connections incident={incidentId} unavailable={unavailable} /> : null}
          </> : null}
        </div> : null}
      </main>
    </>
  );
}
