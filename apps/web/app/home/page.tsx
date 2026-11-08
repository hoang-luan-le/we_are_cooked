import Link from "next/link";
import { redirect } from "next/navigation";
import { currentSession, teamEntryApi } from "../night/demo-config";
import { IntentLink } from "../intent-link";
import { myIncidents } from "../session/session-api";

export const dynamic = "force-dynamic";

const roleLabel = { night: "Night engineer", morning: "Morning engineer", teammate: "Teammate" } as const;

/** The hub: every incident you're on, what's waiting on you, and one Continue button each. */
export default async function HomePage() {
  const session = await currentSession();
  if (session?.mode === "auth0" && (!session.signedIn || !session.user)) redirect(`/session?next=${encodeURIComponent("/home")}`);
  const config = await teamEntryApi();
  if (!config) return (
    <main className="landing"><h1>Your incidents are unavailable here</h1><Link className="button" href="/">Back to Incident Lab</Link></main>
  );
  const mine = (await myIncidents(config))?.filter(row => row.incident_id !== "inc_demo");
  return (
    <main className="landing">
      <p className="eyebrow">Incident Lab · presenting as {config.user}</p>
      <h1>Your incidents</h1>
      <p><IntentLink className="button primary" href="/start">Start a new incident</IntentLink></p>
      {mine === undefined ? <p role="alert">Couldn&apos;t reach the incident service. Check that the API is running.</p>
        : mine.length === 0 ? <p>No incidents yet. Start one, or switch to a teammate who has one.</p> : (
          <ul className="handed-list">
            {mine.map(row => (
              <li key={row.incident_id} className="panel">
                <p><strong>Incident {row.incident_id}</strong> · {row.level} · {roleLabel[row.role]} · {row.phase.replace("_", " ")}</p>
                <p>{row.next_step ? <>Next: <strong>{row.next_step}</strong></> : "Nothing waiting on you right now."}</p>
                <IntentLink className="button primary" href={`/incident/${encodeURIComponent(row.incident_id)}`}>Continue</IntentLink>
              </li>
            ))}
          </ul>
        )}
    </main>
  );
}
