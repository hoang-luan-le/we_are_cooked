import { demoApi } from "../../night/demo-config";
import type { ActionRequest } from "../../../../../packages/contracts/types";

export const dynamic = "force-dynamic";

async function forward(request: Request, action?: ActionRequest) {
  const config = demoApi();
  if (!config) return new Response(null, { status: 404 });
  try {
    const url = new URL(action ? "/api/incident/inc_demo/action" : "/api/incident/inc_demo", config.origin);
    const response = await fetch(url, {
      method: action ? "POST" : "GET",
      body: action ? JSON.stringify(action) : undefined,
      headers: action ? { "Content-Type": "application/json", "X-Demo-User": config.user } : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(6000)]),
    });
    if (!response.ok) return new Response(null, { status: response.status });
    return Response.json(await response.json(), { headers: { "Cache-Control": "no-store" } });
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
    (body.action !== "answer" && body.action !== "snooze" && body.action !== "rollback" && body.action !== "open_panel")) {
    return new Response(null, { status: 422 });
  }
  if (body.action === "open_panel" && body.panel !== "dashboard" && body.panel !== "logs" && body.panel !== "deploys") {
    return new Response(null, { status: 422 });
  }
  return forward(request, { action: body.action, idempotency_key: body.idempotency_key,
    panel: body.action === "open_panel" ? body.panel : undefined });
}
