import Link from "next/link";
import { HISTORY } from "./night/fixture";

export default function Home() {
  const [baseline] = HISTORY;
  const current = HISTORY.at(-1)!;

  return (
    <main className="landing landing-home">
      <section aria-labelledby="landing-title">
        <p className="eyebrow">Incident Lab · On-call simulation</p>
        <h1 id="landing-title">Your first on-call shift starts at 02:04.</h1>
        <p>Checkout is failing during a flash sale. Answer Dana, investigate the release, and bring the service back.</p>
        <nav className="actions" aria-label="Choose a shift">
          <Link className="button primary" href="/start">Night <span aria-hidden="true">→</span></Link>
          <Link className="button" href="/morning/3d">Morning <span aria-hidden="true">→</span></Link>
        </nav>
      </section>
      <section className="panel landing-preview" aria-labelledby="preview-title">
        <div className="section-title">
          <p className="eyebrow">ShopNorth Checkout</p>
          <span className="badge fixture">Scenario preview</span>
        </div>
        <h2 id="preview-title">The flash-sale page</h2>
        <dl className="preview-metrics">
          <div><dt>Checkout errors</dt><dd>{current.errorRate}%</dd><small>Baseline {baseline.errorRate}%</small></div>
          <div><dt>Successful orders</dt><dd>{current.ordersPerMinute}<small>/min</small></dd><small>Baseline {baseline.ordersPerMinute}/min</small></div>
        </dl>
        <ol className="preview-steps">
          <li><strong>Answer</strong> Read Dana’s briefing.</li>
          <li><strong>Investigate</strong> Compare errors and release timing.</li>
          <li><strong>Recover</strong> Confirm a rollback and watch checkout recover.</li>
        </ol>
      </section>
    </main>
  );
}
