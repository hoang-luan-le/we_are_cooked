import Link from "next/link";

export default function NotFound() {
  return (
    <main className="landing">
      <h1>This page doesn’t exist</h1>
      <p>The link may be old or mistyped. Your incidents are still where you left them.</p>
      <Link className="button primary" href="/">Back to Incident Lab</Link>
    </main>
  );
}
