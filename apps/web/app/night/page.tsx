import Link from "next/link";
import { demoApi, demoEnabled, devRelayBase, teamEntryApi } from "./demo-config";
import { FixtureNight } from "./fixture-night";
import { isTeamIncidentId } from "./team-entry-contract";
import { NightRun } from "./night-run";

export const dynamic = "force-dynamic";

export default async function NightPage({ searchParams }: { searchParams: Promise<{ fixture?: string | string[]; entry?: string | string[]; incident?: string | string[] }> }) {
  if (!demoEnabled()) {
    return (
      <main className="landing">
        <p className="eyebrow">Incident Lab</p>
        <h1>Night 2D is unavailable here.</h1>
        <p>This environment needs a configured incident source. Try the development run when it is available.</p>
        <Link className="button" href="/">Back to Incident Lab</Link>
      </main>
    );
  }

  const params = await searchParams;
  const offline = params.fixture === "1";
  if (params.entry !== undefined) {
    const entryId = offline && typeof params.entry === "string" ? params.entry : "";
    return <FixtureNight key={entryId} entryId={entryId} />;
  }
  if (params.incident !== undefined) {
    const config = !offline && params.fixture === undefined ? (await teamEntryApi()) : undefined;
    if (!config || !isTeamIncidentId(params.incident)) {
      return <main className="landing"><h1>Team incident unavailable</h1>
        <Link className="button" href="/start">Back to simulation entry</Link></main>;
    }
    const relayBase = devRelayBase() ?? config.origin.replace(/^http:/, "ws:");
    return <NightRun key={params.incident} apiUser={config.user} incidentId={params.incident} relayBase={relayBase} />;
  }
  const config = offline ? undefined : (await demoApi());
  const relayBase = offline ? undefined : devRelayBase() ?? config?.origin.replace(/^http:/, "ws:");
  return <NightRun key={config ? "api" : "fixture"} apiUser={config?.user} relayBase={relayBase} />;
}
