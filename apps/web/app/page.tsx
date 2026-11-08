import Link from "next/link";

export default function Home() {
  return (
    <main className="landing">
      <p className="eyebrow">Incident Lab</p>
      <h1>Take the 02:04 page.</h1>
      <p>Checkout is failing during a flash sale. Answer Dana, investigate the release, and bring the service back.</p>
      <Link className="button primary" href="/night">Start Night 2D <span aria-hidden="true">→</span></Link>
    </main>
  );
}
