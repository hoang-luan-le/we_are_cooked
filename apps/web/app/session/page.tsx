import Link from "next/link";
import { demoApi } from "../night/demo-config";
import { demoTeam, safeNext } from "./session-api";

export const dynamic = "force-dynamic";

const hints: Record<string, string> = {
  "demo-a": "Night engineer in the demo",
  tung: "Morning engineer in the demo",
};

/** "Present as…": pick who you are. One presenter can switch between the Night and Morning engineer. */
export default async function SessionPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const config = await demoApi();
  if (!config) return (
    <main className="landing"><h1>Sign-in is unavailable here</h1><Link className="button" href="/">Back to Incident Lab</Link></main>
  );
  const { next } = await searchParams;
  const team = await demoTeam(config);
  return (
    <main className="landing">
      <p className="eyebrow">Demo sign-in · currently {config.user}</p>
      <h1>Who are you playing?</h1>
      <p>Pick a teammate. You can switch at any time; one presenter can play both the Night and the Morning engineer.</p>
      {team === undefined ? <p role="alert">Couldn&apos;t reach the incident service. Check that the API is running.</p> : (
        <ul className="handed-list">
          {team.map(handle => (
            <li key={handle} className="panel">
              <form method="post" action="/api/session">
                <input type="hidden" name="handle" value={handle} />
                <input type="hidden" name="next" value={safeNext(next)} />
                <button type="submit" className={handle === config.user ? "button primary" : "button"}>
                  {handle === config.user ? `Continue as ${handle}` : `Present as ${handle}`}
                </button>
                {hints[handle] ? <span className="session-hint"> · {hints[handle]}</span> : null}
              </form>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
