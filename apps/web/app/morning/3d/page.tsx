import Link from "next/link";
import "../../world/world.css";
import { demoEnabled, devRelayBase, teamEntryApi } from "../../night/demo-config";
import { isTeamIncidentId } from "../../night/team-entry-contract";
import { MorningWorld } from "./morning-world";

export const dynamic = "force-dynamic";

export default async function MorningWorldPage({ searchParams }: { searchParams: Promise<{ incident?: string | string[]; fixture?: string | string[]; no3d?: string | string[] }> }) {
  if (!demoEnabled()) return <main className="landing"><h1>Morning is unavailable here.</h1><Link className="button" href="/">Back to Incident Lab</Link></main>;
  const { incident, fixture, no3d } = await searchParams;
  const forceFallback = no3d === "1";
  if (fixture === "1") return <MorningWorld forceFallback={forceFallback} />;
  const config = teamEntryApi();
  if (!config || !isTeamIncidentId(incident)) {
    return <main className="landing"><h1>Morning office unavailable</h1><p>Open a team incident and complete the Night handoff to continue.</p>
      <Link className="button" href="/start">Back to simulation entry</Link></main>;
  }
  const relayBase = devRelayBase() ?? config.origin.replace(/^http:/, "ws:");
  return <MorningWorld forceFallback={forceFallback} team={{ incidentId: incident, user: config.user, relayBase, rehearsalGitHub: process.env.MORNING_GITHUB_FIXTURE === "1" }} />;
}
