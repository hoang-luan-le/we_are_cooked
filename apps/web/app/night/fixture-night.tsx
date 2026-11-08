"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type FixtureEntry, readFixtureEntry, watchFixtureEntry } from "./fixture-entry";
import { NightRun, type NightStage } from "./night-run";

export function FixtureNight({ entryId, onStage }: { entryId: string; onStage?: (stage: NightStage) => void }) {
  const [entry, setEntry] = useState<FixtureEntry | null | undefined>();

  useEffect(() => {
    function refresh() {
      const saved = readFixtureEntry();
      setEntry(current => saved?.id === entryId ? current ?? saved : null);
    }
    refresh();
    return watchFixtureEntry(refresh);
  }, [entryId]);

  if (entry === undefined) return <main className="call-layout"><p role="status">Opening your saved exercise…</p></main>;
  if (!entry) return (
    <main className="landing">
      <h1>Saved exercise unavailable</h1>
      <p>Open simulation entry to resume the exercise saved in this browser or start a new one.</p>
      <Link className="button primary" href="/start">Back to simulation entry</Link>
    </main>
  );

  return <NightRun entry={entry} onStage={onStage} />;
}
