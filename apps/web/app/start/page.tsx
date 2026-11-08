import Link from "next/link";
import { NightWorld } from "../night/3d/night-world";
import { demoApi, demoEnabled, teamEntryApi } from "../night/demo-config";
import "../world/world.css";
import { EntryForm } from "./entry-form";

export const dynamic = "force-dynamic";

export default async function StartPage() {
  if (!demoEnabled()) return (
    <main className="entry-layout">
      <h1>Simulation entry is unavailable here</h1>
      <p className="muted">Open the development environment to try the Night exercise.</p>
      <Link className="button" href="/">Back to Incident Lab</Link>
    </main>
  );

  return <NightWorld setup={
    <>
      <header className="app-header"><Link href="/">Incident Lab</Link></header>
      <main className="entry-layout">
        <div className="board-heading">
          <p className="eyebrow">ShopNorth Checkout · Entry</p>
          <h1>Prepare for your shift.</h1>
          <p>Choose how much guidance you want, then start an exercise or join the rehearsal cohort.</p>
        </div>
        <EntryForm localApiAvailable={Boolean(await demoApi())} teamUser={(await teamEntryApi())?.user} />
      </main>
    </>
  } />;
}
