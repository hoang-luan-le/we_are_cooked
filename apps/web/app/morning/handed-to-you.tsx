import Link from "next/link";
import type { demoApi } from "../night/demo-config";
import { isTeamIncidentId } from "../night/team-entry-contract";
import { AutoRefresh } from "./auto-refresh";

type Config = NonNullable<ReturnType<typeof demoApi>>;

/** One row of GET /api/me/incidents (backend: services/api/engine/my_incidents.py). */
type MyIncident = {
  incident_id: string;
  level: string;
  phase: string;
  role: "night" | "morning" | "teammate";
  handoff_ready: boolean;
  next_step: string | null;
  waiting_on_you: boolean;
};

const roleLabel: Record<MyIncident["role"], string> = {
  morning: "You are the Morning pair",
  night: "You were on the Night shift",
  teammate: "You are a teammate",
};

async function loadMine(config: Config): Promise<MyIncident[] | undefined> {
  try {
    const response = await fetch(new URL("/api/me/incidents", config.origin), {
      headers: { "X-Demo-User": config.user },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok) return;
    const body: { incidents?: MyIncident[] } = await response.json();
    return Array.isArray(body.incidents) ? body.incidents.filter(row => isTeamIncidentId(row.incident_id)) : undefined;
  } catch {
    return;
  }
}

/** Shown on /morning and /morning/3d when no incident is chosen: what was handed to you, one click away. */
export async function HandedToYou({ config, base }: { config: Config; base: "/morning" | "/morning/3d" }) {
  const mine = await loadMine(config);
  const handed = mine?.filter(row => row.handoff_ready) ?? [];
  const onNight = mine?.filter(row => !row.handoff_ready) ?? [];
  const place = base === "/morning/3d" ? "Morning office" : "Morning workspace";

  return (
    <main className="landing handed-to-you">
      <p className="eyebrow">Morning shift · signed in as {config.user}</p>
      <h1>Your morning</h1>
      {mine === undefined ? (
        <p role="alert">Couldn&apos;t reach the incident service. Check that the API is running, then refresh this page.</p>
      ) : handed.length === 0 ? (
        <>
          <p role="status">Nothing has been handed to you yet. When the Night pair finishes and names you in their
            handoff, it appears here. This page checks again every few seconds.</p>
          <AutoRefresh />
        </>
      ) : (
        <section aria-labelledby="handed-title">
          <h2 id="handed-title">Handed to you</h2>
          <ul className="handed-list">
            {handed.map(row => (
              <li key={row.incident_id} className="panel">
                <p><strong>Incident {row.incident_id}</strong> · {row.level} · {roleLabel[row.role]}</p>
                <p>{row.next_step ? <>Next: <strong>{row.next_step}</strong></> : "Nothing waiting on you."}</p>
                <Link className="button primary" href={`${base}?incident=${encodeURIComponent(row.incident_id)}`}>
                  Open {place}
                </Link>
                {base === "/morning" ? (
                  <Link className="button" href={`/morning/3d?incident=${encodeURIComponent(row.incident_id)}`}>
                    Open in the 3D office
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      )}
      {onNight.length > 0 ? (
        <section aria-labelledby="night-title">
          <h2 id="night-title">Still on the Night shift</h2>
          <ul className="handed-list">
            {onNight.map(row => (
              <li key={row.incident_id} className="panel">
                <p><strong>Incident {row.incident_id}</strong> · {row.level} · {roleLabel[row.role]}</p>
                <p>{row.next_step ?? "Waiting for the Night pair's handoff."}</p>
                <Link className="button" href={`/night?incident=${encodeURIComponent(row.incident_id)}`}>Open Night board</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <Link className="button" href="/start">Back to simulation entry</Link>
    </main>
  );
}
