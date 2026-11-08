import { demoApi, fetchDemo, teamEntryApi } from "../../night/demo-config";
import { isTeamIncidentId } from "../../night/team-entry-contract";
import type { ActionRequest } from "../../../../../packages/contracts/types";

export const dynamic = "force-dynamic";

async function forward(request: Request, action?: ActionRequest) {
  const ids = new URL(request.url).searchParams.getAll("incident");
  const teamIncident = ids.length > 0;
  const config = teamIncident ? teamEntryApi() : demoApi();
  if (!config) return new Response(null, { status: 404 });
  if (teamIncident && (ids.length !== 1 || !isTeamIncidentId(ids[0]))) return new Response(null, { status: 422 });
  try {
    const path = `/api/incident/${ids[0] ?? "inc_demo"}`;
    const response = await fetchDemo(request, config, action ? `${path}/action` : path, action);
    if (!response.ok) return new Response(null, { status: response.status });
    const data = await response.json();
    if (teamIncident && !action && (data.incident_id !== ids[0] || !Array.isArray(data.teammates) || !data.teammates.includes(config.user))) {
      return new Response(null, { status: 404 });
    }
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}

export function GET(request: Request) {
  return forward(request);
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return new Response(null, { status: 415 });
  }
  const body: Partial<ActionRequest> | null = await request.json().catch(() => null);
  if (!body || typeof body.idempotency_key !== "string" || !body.idempotency_key ||
    body.idempotency_key.length > 128 ||
    (body.action !== "answer" && body.action !== "snooze" && body.action !== "rollback" && body.action !== "open_panel" &&
      body.action !== "share_finding" && body.action !== "status_update")) {
    return new Response(null, { status: 422 });
  }
  if (body.action === "open_panel" && body.panel !== "dashboard" && body.panel !== "logs" && body.panel !== "deploys") {
    return new Response(null, { status: 422 });
  }
  const note = body.action === "share_finding" || body.action === "status_update";
  const limit = body.action === "share_finding" ? 280 : 500;
  if (note && (typeof body.text !== "string" || !body.text.trim() || body.text.trim().length > limit)) {
    return new Response(null, { status: 422 });
  }
  return forward(request, { action: body.action, idempotency_key: body.idempotency_key,
    panel: body.action === "open_panel" ? body.panel : undefined, text: note ? body.text?.trim() : undefined });
}
