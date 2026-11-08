import Link from "next/link";

export default function Home() {
  return (
    <main className="landing">
      <p className="eyebrow">Incident Lab</p>
      <h1>Your first on-call shift starts at 02:04.</h1>
      <p>Checkout is failing during a flash sale. Answer Dana, investigate the release, and bring the service back.</p>
      <Link className="button primary" href="/start">Start simulation <span aria-hidden="true">→</span></Link>
    </main>
  );
}
