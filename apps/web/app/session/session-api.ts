import type { DemoConfig } from "../night/demo-config";

/** Small server-side helpers for the one-app shell (session, home, incident router). */

async function getJson<T>(config: DemoConfig, path: string): Promise<{ status: number; body?: T }> {
  try {
    const response = await fetch(new URL(path, config.origin), {
      headers: { "X-Demo-User": config.user }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000),
    });
    return { status: response.status, body: response.ok ? await response.json() as T : undefined };
  } catch {
    return { status: 503 };
  }
}

/** The handles you may present as (demo mode). */
export async function demoTeam(config: DemoConfig): Promise<string[] | undefined> {
  const { body } = await getJson<{ team?: string[] }>(config, "/api/demo/team");
  return Array.isArray(body?.team) ? body.team : undefined;
}

export type MyIncident = {
  incident_id: string; level: string; phase: string; status: string;
  role: "night" | "morning" | "teammate"; handoff_ready: boolean; next_step: string | null; waiting_on_you: boolean;
};

export async function myIncidents(config: DemoConfig): Promise<MyIncident[] | undefined> {
  const { body } = await getJson<{ incidents?: MyIncident[] }>(config, "/api/me/incidents");
  return Array.isArray(body?.incidents) ? body.incidents : undefined;
}

export type IncidentSummary = { incident_id: string; phase: string; handoff: { morning_pair: string[] } | null };

export async function incident(config: DemoConfig, id: string) {
  return getJson<IncidentSummary>(config, `/api/incident/${encodeURIComponent(id)}`);
}

/** Only same-site relative paths: never an open redirect. */
export function safeNext(value: unknown, fallback = "/home"): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")
    ? value : fallback;
}
