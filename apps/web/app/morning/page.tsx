import Link from "next/link";
import { devRelayBase, teamEntryApi } from "../night/demo-config";
import { isTeamIncidentId } from "../night/team-entry-contract";
import { HandedToYou } from "./handed-to-you";
import { MorningWorkspace } from "./morning-workspace";
import { loadPilot } from "./pilot";

export const dynamic = "force-dynamic";

export default async function MorningPage({ searchParams }: { searchParams: Promise<{ incident?: string | string[] }> }) {
  const { incident } = await searchParams;
  const config = (await teamEntryApi());
  // No incident chosen: show what has been handed to this person, one click away.
  if (config && !isTeamIncidentId(incident)) return <HandedToYou config={config} base="/morning" />;
  if (!config || !isTeamIncidentId(incident)) return (
    <main className="landing">
      <h1>Morning workspace unavailable</h1>
      <p>Open a team incident and complete the Night handoff to continue.</p>
      <Link className="button" href="/start">Back to simulation entry</Link>
    </main>
  );

  const relayBase = devRelayBase() ?? config.origin.replace(/^http:/, "ws:");
  const pilot = await loadPilot(config);
  return <MorningWorkspace key={incident} incidentId={incident} user={config.user} relayBase={relayBase}
    rehearsalGitHub={process.env.MORNING_GITHUB_FIXTURE === "1"} pilot={pilot} />;
}
