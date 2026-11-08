import Link from "next/link";
import { demoApi, demoEnabled } from "../night/demo-config";
import { EntryForm } from "./entry-form";

export const dynamic = "force-dynamic";

export default function StartPage() {
  const available = demoEnabled();

  return (
    <>
      <header className="app-header"><Link href="/">Incident Lab</Link></header>
      <main className="entry-layout">
        <div className="board-heading">
          <p className="eyebrow">ShopNorth Checkout · Entry</p>
          <h1>Prepare for your shift.</h1>
          <p>Choose how much guidance you want, then start an exercise or join the rehearsal cohort.</p>
        </div>
        {available ? <EntryForm localApiAvailable={Boolean(demoApi())} /> : (
          <section className="panel entry-section">
            <h2>Simulation entry is unavailable here</h2>
            <p className="muted">Open the development environment to try the Night exercise.</p>
            <Link className="button" href="/">Back to Incident Lab</Link>
          </section>
        )}
      </main>
    </>
  );
}
