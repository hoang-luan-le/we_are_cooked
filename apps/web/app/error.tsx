"use client";

import Link from "next/link";

export default function PageError({ reset }: { reset: () => void }) {
  return (
    <main className="landing">
      <h1>This page didn’t load</h1>
      <p role="alert">Something stopped this page from opening. Try again, or go back to the start.</p>
      <button className="primary" onClick={reset}>Try again</button>{" "}
      <Link className="button" href="/">Back to Incident Lab</Link>
    </main>
  );
}
