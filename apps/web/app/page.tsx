import Image from "next/image";
import { IntentLink } from "./intent-link";
import { HISTORY, RECOVERY } from "./night/fixture";
import { IncidentTrace } from "./incident-trace";

const events: Record<number, string> = { 0: "Release v2.14.0", 3: "Dana calls you", 6: "Rollback complete" };

export default function Home() {
  const points = [...HISTORY, ...RECOVERY].map((sample, index) => ({
    time: sample.time, errorRate: sample.errorRate, ordersPerMinute: sample.ordersPerMinute, event: events[index],
  }));

  return (
    <main className="landing landing-home">
      <p className="landing-brand">Incident Lab</p>
      <section className="landing-hero" aria-labelledby="landing-title">
        <h1 id="landing-title">Your first on-call shift starts at 02:04.</h1>
        <div className="landing-lead">
          <p>Checkout is failing during a flash sale. Answer Dana, investigate the release, and bring the service back.</p>
          <nav className="actions" aria-label="Choose a shift">
            <IntentLink className="button primary" href="/start">Night</IntentLink>
            <IntentLink className="button" href="/morning/3d">Morning</IntentLink>
          </nav>
        </div>
      </section>

      <section className="panel trace" aria-labelledby="preview-title">
        <div className="trace-head">
          <h2 id="preview-title">The flash-sale page</h2>
          <span className="badge fixture">Simulated incident</span>
        </div>
        <IncidentTrace points={points} initial={3} />
        <ol className="preview-steps">
          <li><strong>Answer</strong> Hear Dana’s briefing.</li>
          <li><strong>Investigate</strong> Compare errors and release timing.</li>
          <li><strong>Recover</strong> Confirm a rollback and watch checkout recover.</li>
        </ol>
      </section>

      <section className="shifts" aria-labelledby="shifts-title">
        <h2 id="shifts-title">One incident, two shifts</h2>
        <div className="shifts-grid">
          <article className="shift">
            <Image src="/world/bedroom-still.png" alt="A dark bedroom at night with a phone ringing on the nightstand and an incident board on the desk monitor." width={1280} height={720} sizes="(max-width: 760px) 100vw, 560px" />
            <div><h3>Night</h3><p>Wake to the call, find the release that broke checkout, and roll it back.</p></div>
          </article>
          <article className="shift">
            <Image src="/world/office-still.png" alt="The glass entrance of the ShopNorth office in daylight, with signs to Dana’s briefing room and the workstations." width={1280} height={720} sizes="(max-width: 760px) 100vw, 560px" />
            <div><h3>Morning</h3><p>Join Dana’s review, then write and check the permanent fix.</p></div>
          </article>
        </div>
        <p className="landing-note muted">Everything here is a simulation. No real systems or customer data are involved.</p>
      </section>
    </main>
  );
}
