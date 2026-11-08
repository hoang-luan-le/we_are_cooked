import Link from "next/link";
import { demoApi, demoEnabled } from "./demo-config";
import { FixtureNight } from "./fixture-night";
import { NightRun } from "./night-run";

export const dynamic = "force-dynamic";

function devRelayBase() {
  try {
    const url = new URL(process.env.DANA_DEV_WS_BASE ?? "");
    if (["ws:", "wss:"].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === "/") {
      return url.origin;
    }
  } catch {
    // The optional relay is absent or misconfigured. The scripted briefing still works.
  }
}

export default async function NightPage({ searchParams }: { searchParams: Promise<{ fixture?: string; entry?: string }> }) {
  if (!demoEnabled()) {
    return (
      <main className="landing">
        <p className="eyebrow">Incident Lab</p>
        <h1>Night 2D is unavailable here.</h1>
        <p>This environment needs a configured incident source. Try the development run when it is available.</p>
        <Link className="button" href="/">Back to Incident Lab</Link>
      </main>
    );
  }

  const params = await searchParams;
  const offline = params.fixture === "1";
  if (offline && typeof params.entry === "string") return <FixtureNight key={params.entry} entryId={params.entry} />;
  const config = offline ? undefined : demoApi();
  const relayBase = offline ? undefined : devRelayBase() ?? config?.origin.replace(/^http:/, "ws:");
  return <NightRun key={config ? "api" : "fixture"} apiUser={config?.user} relayBase={relayBase} />;
}
