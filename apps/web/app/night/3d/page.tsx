import Link from "next/link";
import "../../world/world.css";
import { demoApi, demoEnabled, devRelayBase, teamEntryApi } from "../demo-config";
import { isTeamIncidentId } from "../team-entry-contract";
import { NightWorld } from "./night-world";

export const dynamic = "force-dynamic";

type Params = { fixture?: string | string[]; entry?: string | string[]; incident?: string | string[]; no3d?: string | string[] };

// Same source selection as /night, so 2D and 3D open the same incident.
export default async function NightWorldPage({ searchParams }: { searchParams: Promise<Params> }) {
  if (!demoEnabled()) return <main className="landing"><h1>Night is unavailable here.</h1><Link className="button" href="/">Back to Incident Lab</Link></main>;
  const params = await searchParams;
  const offline = params.fixture === "1";
  const forceFallback = params.no3d === "1";
  if (params.entry !== undefined) {
    return <NightWorld entryId={offline && typeof params.entry === "string" ? params.entry : ""} run={{}} forceFallback={forceFallback} />;
  }
  if (params.incident !== undefined) {
    const config = !offline && params.fixture === undefined ? (await teamEntryApi()) : undefined;
    if (!config || !isTeamIncidentId(params.incident)) {
      return <main className="landing"><h1>Team incident unavailable</h1><Link className="button" href="/start">Back to simulation entry</Link></main>;
    }
    const relayBase = devRelayBase() ?? config.origin.replace(/^http:/, "ws:");
    return <NightWorld run={{ apiUser: config.user, incidentId: params.incident, relayBase }} forceFallback={forceFallback} />;
  }
  const config = offline ? undefined : (await demoApi());
  const relayBase = offline ? undefined : devRelayBase() ?? config?.origin.replace(/^http:/, "ws:");
  return <NightWorld run={{ apiUser: config?.user, relayBase }} forceFallback={forceFallback} />;
}
