import Link from "next/link";
import { currentSession, demoApi } from "../night/demo-config";
import { demoTeam, safeNext } from "./session-api";

export const dynamic = "force-dynamic";

const hints: Record<string, string> = {
  "demo-a": "Night engineer in the demo",
  tung: "Morning engineer in the demo",
};

const errors: Record<string, string> = {
  handle_taken: "That handle is taken. Try another.",
  bad_handle: "Use 1-32 lowercase letters, digits, - or _. No real names needed.",
  unavailable: "Couldn't save your handle. Check that the API is running and try again.",
};

/** Demo mode: "Present as..." (one presenter can switch). Auth0 mode: sign in, then pick a handle once. */
export default async function SessionPage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}) {
  const session = await currentSession();
  const { next, error } = await searchParams;
  const back = safeNext(next);
  if (!session) return (
    <main className="landing"><h1>Sign-in is unavailable here</h1><Link className="button" href="/">Back to Incident Lab</Link></main>
  );

  if (session.mode === "auth0") {
    if (!session.signedIn) return (
      <main className="landing">
        <h1>Sign in</h1>
        <p>Sign in with Google to start or join an incident. Other people only ever see the handle you pick.</p>
        <a className="button primary" href={`/auth/login?returnTo=${encodeURIComponent(back)}`}>Sign in with Google</a>
      </main>
    );
    if (!session.user) return (
      <main className="landing">
        <p className="eyebrow">One last step</p>
        <h1>Pick your handle</h1>
        <p>Your handle is the only name teammates see. Use letters, digits, - or _; no real name needed.</p>
        {typeof error === "string" && errors[error] ? <p role="alert">{errors[error]}</p> : null}
        <form method="post" action="/api/session" className="entry-section">
          <label htmlFor="handle">Handle</label>
          <input id="handle" name="handle" required maxLength={32} pattern="[a-z0-9][a-z0-9_\-]{0,31}" autoComplete="off" />
          <input type="hidden" name="next" value={back} />
          <button type="submit" className="button primary">Save handle</button>
        </form>
      </main>
    );
    return (
      <main className="landing">
        <p className="eyebrow">Signed in</p>
        <h1>You are {session.user}</h1>
        <p>To play the other shift, sign out and sign in with your teammate&apos;s account (or use a second browser profile).</p>
        <Link className="button primary" href="/home">Your incidents</Link>
        <a className="button" href="/auth/logout">Sign out</a>
      </main>
    );
  }

  const config = await demoApi();
  const team = config ? await demoTeam(config) : undefined;
  return (
    <main className="landing">
      <p className="eyebrow">Demo sign-in · currently {session.user}</p>
      <h1>Who are you playing?</h1>
      <p>Pick a teammate. You can switch at any time; one presenter can play both the Night and the Morning engineer.</p>
      {team === undefined ? <p role="alert">Couldn&apos;t reach the incident service. Check that the API is running.</p> : (
        <ul className="handed-list">
          {team.map(handle => (
            <li key={handle} className="panel">
              <form method="post" action="/api/session">
                <input type="hidden" name="handle" value={handle} />
                <input type="hidden" name="next" value={back} />
                <button type="submit" className={handle === session.user ? "button primary" : "button"}>
                  {handle === session.user ? `Continue as ${handle}` : `Present as ${handle}`}
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
