import type { IncidentState, Panel } from "../../../../../../packages/contracts/types";
import { fetchDemo, teamEntryApi } from "../../../night/demo-config";
import { isTeamIncidentId } from "../../../night/team-entry-contract";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const config = (await teamEntryApi());
  if (!config) return new Response(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const ids = params.getAll("incident");
  if (ids.length !== 1 || !isTeamIncidentId(ids[0])) return new Response(null, { status: 422 });
  const [id] = ids;
  const panel = params.get("panel");
  let required: Panel;
  let resource: string;
  switch (panel) {
    case "logs": {
      const severity = params.get("severity");
      const query = params.get("q") ?? "";
      if ((severity && !["INFO", "WARN", "ERROR"].includes(severity)) || query.length > 50) {
        return new Response(null, { status: 422 });
      }
      const filters = new URLSearchParams({ limit: "60" });
      if (severity) filters.set("level", severity);
      if (query.trim()) filters.set("q", query.trim());
      required = "logs";
      resource = `logs?${filters}`;
      break;
    }
    case "deploys":
      required = "deploys";
      resource = "deploys";
      break;
    case "runbook": {
      const name = params.get("name");
      if (name !== null && !/^[a-z0-9_-]{1,64}$/.test(name)) return new Response(null, { status: 422 });
      required = "runbook";
      resource = name ? `runbooks/${name}` : "runbooks";
      break;
    }
    case "history":
      required = "dashboard";
      resource = "metrics/history?window_s=1200&step_s=30";
      break;
    default:
      return new Response(null, { status: 422 });
  }

  try {
    const base = `/api/incident/${id}`;
    const lookup = await fetchDemo(request, config, base);
    if (!lookup.ok) return new Response(null, { status: lookup.status });
    const incident: IncidentState = await lookup.json();
    if (incident.incident_id !== id || !incident.teammates?.includes(config.user)) return new Response(null, { status: 404 });
    if (!incident.unlocked?.includes(required)) return new Response(null, { status: 403 });

    const response = await fetchDemo(request, config, `${base}/${resource}`);
    if (!response.ok) return new Response(null, { status: response.status });
    return Response.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return new Response(null, { status: 503 });
  }
}
