import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession, teamEntryApi } from "../../night/demo-config";
import { isTeamIncidentId } from "../../night/team-entry-contract";
import { incident } from "../../session/session-api";

export const dynamic = "force-dynamic";

/**
 * One address per incident. Sends you to the right stage in Tung's pages:
 * Night (call, board, handoff) until the handoff is written, Morning after it. Both open in 3D.
 */
export default async function IncidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const returnTo = `/incident/${encodeURIComponent(id)}`;
  const session = await currentSession();
  if (session?.mode === "auth0" && (!session.signedIn || !session.user)) redirect(`/session?next=${encodeURIComponent(returnTo)}`);
  const config = await teamEntryApi();
  if (!config || !isTeamIncidentId(id)) return (
    <main className="landing"><h1>Incident unavailable</h1><Link className="button" href="/home">Your incidents</Link></main>
  );
  const { status, body } = await incident(config, id);
  if (!body) return (
    <main className="landing">
      <h1>{status === 404 ? "No such incident" : "You aren't on this incident"}</h1>
      <p>You're presenting as {config.user}. Switch to a teammate on this incident, or go back to your incidents.</p>
      <Link className="button primary" href={`/session?next=${encodeURIComponent(returnTo)}`}>Switch who you are</Link>
      <Link className="button" href="/home">Your incidents</Link>
    </main>
  );
  const stage = body.handoff ? "morning" : "night";
  redirect(`/${stage}/3d?incident=${encodeURIComponent(id)}`);
}
