import { fetchDemo, teamEntryApi } from "../../../night/demo-config";
import { type CohortRoster, isCohortId, isTeamIncidentId } from "../../../night/team-entry-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = teamEntryApi();
  if (!config) return new Response(null, { status: 404 });
  const ids = new URL(request.url).searchParams.getAll("cohort");
  if (ids.length !== 1 || !isCohortId(ids[0])) return new Response(null, { status: 422 });
  return roster(request, config, `/api/cohorts/${ids[0]}`);
}

async function roster(request: Request, config: NonNullable<ReturnType<typeof teamEntryApi>>, path: string, body?: object) {
  try {
    const response = await fetchDemo(request, config, path, body);
    if (!response.ok) return new Response(null, { status: response.status });
    const { id, name, members }: CohortRoster = await response.json();
    if (!isCohortId(id) || typeof name !== "string" || !Array.isArray(members) ||
      !members.every(member => typeof member?.handle === "string")) return new Response(null, { status: 502 });
    return Response.json({ id, name, members: members.map(({ handle }) => ({ handle })) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}

export async function POST(request: Request) {
  const config = teamEntryApi();
  if (!config) return new Response(null, { status: 404 });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return new Response(null, { status: 415 });
  const body = await request.json().catch(() => null);
  if (body?.kind === "join" && typeof body.code === "string" && /^[A-Z0-9]{6}$/.test(body.code)) {
    return roster(request, config, "/api/cohorts/join", { join_code: body.code });
  }
  if (body?.kind !== "start" || !["explore", "practice", "challenge"].includes(body.level) ||
    !Array.isArray(body.teammates) || body.teammates.length > 3 ||
    !body.teammates.every((handle: unknown) => typeof handle === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(handle))) {
    return new Response(null, { status: 422 });
  }
  try {
    const response = await fetchDemo(request, config, "/api/incident/start", { level: body.level, teammates: body.teammates });
    if (!response.ok) return new Response(null, { status: response.status });
    const { incident_id: id } = await response.json();
    if (!isTeamIncidentId(id)) return new Response(null, { status: 502 });
    return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
