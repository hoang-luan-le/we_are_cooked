import type { HandoffRequest } from "../../../../../../packages/contracts/types";
import { fetchDemo, teamEntryApi } from "../../../night/demo-config";
import { isTeamIncidentId } from "../../../night/team-entry-contract";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const config = teamEntryApi();
  if (!config) return new Response(null, { status: 404 });
  const ids = new URL(request.url).searchParams.getAll("incident");
  if (ids.length !== 1 || !isTeamIncidentId(ids[0])) return new Response(null, { status: 422 });
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return new Response(null, { status: 415 });
  }
  const body: Partial<HandoffRequest> | null = await request.json().catch(() => null);
  const validPart = (part: unknown): part is string => typeof part === "string" && part.trim().length > 0 && part.length <= 1000;
  if (!body || !validPart(body.what_happened) || !validPart(body.current_state) ||
    !validPart(body.tried) || !validPart(body.risks) || !Array.isArray(body.morning_pair) ||
    body.morning_pair.length > 4 ||
    !body.morning_pair.every(handle => typeof handle === "string" && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(handle))) {
    return new Response(null, { status: 422 });
  }

  try {
    const response = await fetchDemo(request, config, `/api/incident/${ids[0]}/handoff`, {
      what_happened: body.what_happened.trim(), current_state: body.current_state.trim(),
      tried: body.tried.trim(), risks: body.risks.trim(), morning_pair: body.morning_pair,
    } satisfies HandoffRequest);
    if (!response.ok) return new Response(null, { status: response.status });
    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
