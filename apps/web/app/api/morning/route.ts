import type { Evidence, IncidentState, NetworkCard } from "../../../../../packages/contracts/types";
import { githubPullUrl } from "../../morning/morning-contract";
import { fetchDemo, teamEntryApi } from "../../night/demo-config";
import { isTeamIncidentId } from "../../night/team-entry-contract";

export const dynamic = "force-dynamic";

async function authorized(request: Request) {
  const config = (await teamEntryApi());
  if (!config) return new Response(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  const ids = params.getAll("incident");
  if (ids.length !== 1 || !isTeamIncidentId(ids[0])) return new Response(null, { status: 422 });
  const [id] = ids;
  const base = `/api/incident/${id}`;
  const response = await fetchDemo(request, config, base);
  if (!response.ok) return new Response(null, { status: response.status });
  const incident: IncidentState = await response.json();
  if (incident.incident_id !== id || !incident.teammates?.includes(config.user)) return new Response(null, { status: 404 });
  return { config, id, base, params, incident };
}

function reply(data: unknown) {
  return Response.json(data, { headers: { "Cache-Control": "no-store" } });
}

async function rejected(response: Response) {
  const body = await response.json().catch(() => null);
  return Response.json({ code: typeof body?.code === "string" ? body.code : undefined }, { status: response.status });
}

export async function GET(request: Request) {
  try {
    const target = await authorized(request);
    if (target instanceof Response) return target;
    const { config, id, params, incident } = target;
    const resource = params.get("resource");
    if (resource === "checks") {
      const response = await fetchDemo(request, config, `/api/checks?incident_id=${id}`);
      return response.ok ? reply(await response.json()) : rejected(response);
    }
    if (!incident.handoff) return new Response(null, { status: 409 });
    if (resource === "evidence") {
      const response = await fetchDemo(request, config, "/api/me/evidence");
      if (!response.ok) return rejected(response);
      const evidence: Evidence = await response.json();
      return reply({ handle: evidence.handle, record: evidence.incidents.find(item => item.incident_id === id) ?? null });
    }
    if (resource === "connections") {
      const [pending, network] = await Promise.all([
        fetchDemo(request, config, "/api/connections/pending"),
        fetchDemo(request, config, "/api/network"),
      ]);
      if (!pending.ok) return rejected(pending);
      if (!network.ok) return rejected(network);
      const invitations: { pending: { incident_id: string; handle: string }[] } = await pending.json();
      const connections: { cards: NetworkCard[] } = await network.json();
      return reply({
        pending: invitations.pending.filter(item => item.incident_id === id).map(item => item.handle),
        cards: connections.cards.filter(card => card.incident_id === id),
      });
    }
    return new Response(null, { status: 422 });
  } catch {
    return new Response(null, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") {
    return new Response(null, { status: 415 });
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body.operation !== "string") return new Response(null, { status: 422 });
  try {
    const target = await authorized(request);
    if (target instanceof Response) return target;
    const { config, id, base, incident } = target;
    if (body.operation !== "check" && !incident.handoff) return new Response(null, { status: 409 });
    let path: string;
    let payload: object;
    switch (body.operation) {
      case "verify": {
        const url = typeof body.url === "string" && body.url.length <= 300 ? githubPullUrl(body.url) : undefined;
        if (!url) return Response.json({ code: "bad_pr_url" }, { status: 422 });
        path = "/api/pr/verify";
        payload = { incident_id: id, pr_url: url };
        break;
      }
      case "rate":
        if (!Number.isInteger(body.score) || body.score < 1 || body.score > 5 ||
          typeof body.note !== "string" || body.note.length > 200 || /[\r\n]/.test(body.note)) {
          return new Response(null, { status: 422 });
        }
        path = `${base}/handoff/rating`;
        payload = { score: body.score, note: body.note };
        break;
      case "check":
        if (!["before", "after"].includes(body.stage) || typeof body.choice !== "string" || !/^[a-z0-9_-]{1,8}$/.test(body.choice) ||
          typeof body.explanation !== "string" || body.explanation.length > 500) {
          return new Response(null, { status: 422 });
        }
        path = "/api/checks";
        payload = { incident_id: id, stage: body.stage, choice: body.choice, explanation: body.explanation };
        break;
      case "connect":
        if ((incident.phase !== "fixed" && incident.phase !== "debriefed") ||
          typeof body.handle !== "string" || !/^[a-z0-9][a-z0-9_-]{0,31}$/.test(body.handle) || typeof body.workAgain !== "boolean") {
          return new Response(null, { status: 422 });
        }
        path = "/api/connections";
        payload = { incident_id: id, to_user: body.handle, work_again: body.workAgain };
        break;
      case "debrief":
        if (incident.status !== "fixed" || !["fixed", "debriefed"].includes(incident.phase)) return new Response(null, { status: 409 });
        if (typeof body.answer !== "string" || !body.answer.trim() || body.answer.length > 3000) {
          return new Response(null, { status: 422 });
        }
        path = "/api/debrief";
        payload = { incident_id: id, answer: body.answer };
        break;
      default:
        return new Response(null, { status: 422 });
    }
    const response = await fetchDemo(request, config, path, payload);
    if (!response.ok) return rejected(response);
    return reply(await response.json());
  } catch {
    return new Response(null, { status: 503 });
  }
}
