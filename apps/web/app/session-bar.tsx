import Link from "next/link";
import { teamEntryApi } from "./night/demo-config";

/** On every page: who you're presenting as, a quick switch, and the way home. Hidden when team entry is off. */
export async function SessionBar() {
  const config = await teamEntryApi();
  if (!config) return null;
  return (
    <nav className="session-bar" aria-label="Session">
      <span>Presenting as <strong>{config.user}</strong></span>
      <Link href="/session">Switch who you are</Link>
      <Link href="/home">Your incidents</Link>
    </nav>
  );
}
