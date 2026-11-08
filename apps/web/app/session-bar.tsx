import Link from "next/link";
import { currentSession } from "./night/demo-config";

/** On every page: who you are and how to switch / sign in. Hidden when team entry is off. */
export async function SessionBar() {
  if (process.env.NIGHT_TEAM_ENTRY !== "1") return null;
  const session = await currentSession();
  if (!session) return null;
  return (
    <nav className="session-bar" aria-label="Session">
      {session.mode === "demo" ? (
        <>
          <span>Presenting as <strong>{session.user}</strong></span>
          <Link href="/session">Switch who you are</Link>
        </>
      ) : !session.signedIn ? (
        // Plain <a>: the SDK route must not be prefetched (it would start a login).
        <a href="/auth/login?returnTo=/home">Sign in with Google</a>
      ) : !session.user ? (
        <>
          <span>Signed in</span>
          <Link href="/session">Pick your handle</Link>
          <a href="/auth/logout">Sign out</a>
        </>
      ) : (
        <>
          <span>Signed in as <strong>{session.user}</strong></span>
          <a href="/auth/logout">Sign out</a>
        </>
      )}
      <Link href="/home">Your incidents</Link>
    </nav>
  );
}
