import Link from "next/link";
import { redirect } from "next/navigation";
import { teamEntryApi } from "../../night/demo-config";
import { isTeamIncidentId } from "../../night/team-entry-contract";
import { incident } from "../../session/session-api";

export const dynamic = "force-dynamic";

/**
 * One address per incident. Sends you to the right stage in Tung's pages:
 * Night (call, board, handoff) until the handoff is written, Morning after it. 2D by default; ?view=3d for 3D.
 */
export default async function IncidentPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ view?: string | string[] }>;
}) {
  const { id } = await params;
  const { view } = await searchParams;
  const config = await teamEntryApi();
  if (!config || !isTeamIncidentId(id)) return (
    <main className="landing"><h1>Incident unavailable</h1><Link className="button" href="/home">Your incidents</Link></main>
  );
  const { status, body } = await incident(config, id);
  if (!body) return (
    <main className="landing">
      <h1>{status === 404 ? "No such incident" : "You aren't on this incident"}</h1>
      <p>You're presenting as {config.user}. Switch to a teammate on this incident, or go back to your incidents.</p>
      <Link className="button primary" href={`/session?next=${encodeURIComponent(`/incident/${id}`)}`}>Switch who you are</Link>
      <Link className="button" href="/home">Your incidents</Link>
    </main>
  );
  const stage = body.handoff ? "morning" : "night";
  redirect(`/${stage}${view === "3d" ? "/3d" : ""}?incident=${encodeURIComponent(id)}`);
}
