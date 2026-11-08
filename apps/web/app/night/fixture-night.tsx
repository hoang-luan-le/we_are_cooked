"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type FixtureEntry, readFixtureEntry } from "./fixture-entry";
import { NightRun } from "./night-run";

export function FixtureNight({ entryId }: { entryId: string }) {
  const [entry, setEntry] = useState<FixtureEntry | null | undefined>();

  useEffect(() => {
    const saved = readFixtureEntry();
    setEntry(saved?.id === entryId ? saved : null);
  }, [entryId]);

  if (entry === undefined) return <main className="call-layout"><p role="status">Opening your saved exercise…</p></main>;
  if (!entry) return (
    <main className="landing">
      <h1>Saved exercise unavailable</h1>
      <p>Open simulation entry to resume the exercise saved in this browser or start a new one.</p>
      <Link className="button primary" href="/start">Back to simulation entry</Link>
    </main>
  );

  return <NightRun entry={entry} />;
}
