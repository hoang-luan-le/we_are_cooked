import { NextResponse } from "next/server";
import { currentSession, demoApi, HANDLE, SESSION_COOKIE } from "../../night/demo-config";
import { demoTeam, safeNext } from "../../session/session-api";

export const dynamic = "force-dynamic";

/** Same-host relative redirect (127.0.0.1 and localhost keep separate cookies). */
function goTo(path: string) {
  return new NextResponse(null, { status: 303, headers: { Location: path } });
}

/**
 * Demo mode: "Present as <handle>" sets the session cookie.
 * Auth0 mode: claims the signed-in account's handle once (POST /api/me/handle with the user's token).
 */
export async function POST(request: Request) {
  const session = await currentSession();
  if (!session) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const handle = String(form?.get("handle") ?? "").trim().toLowerCase();
  const next = safeNext(form?.get("next"));

  if (session.mode === "auth0") {
    if (!session.signedIn) return goTo(`/auth/login?returnTo=${encodeURIComponent(next)}`);
    // Already has a handle: switching people means signing in as the other person, never claiming their handle.
    if (session.user) return goTo(`/session?next=${encodeURIComponent(next)}`);
    if (!HANDLE.test(handle)) return goTo(`/session?error=bad_handle&next=${encodeURIComponent(next)}`);
    try {
      const origin = new URL(process.env.NIGHT_API_ORIGIN ?? "").origin;
      const response = await fetch(new URL("/api/me/handle", origin), {
        method: "POST", body: JSON.stringify({ handle }),
        headers: { ...session.headers, "Content-Type": "application/json" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000),
      });
      if (response.ok) return goTo(next);
      const body: { code?: string } = await response.json().catch(() => ({}));
      const code = body.code === "handle_taken" || body.code === "bad_handle" ? body.code : "unavailable";
      return goTo(`/session?error=${code}&next=${encodeURIComponent(next)}`);
    } catch {
      return goTo(`/session?error=unavailable&next=${encodeURIComponent(next)}`);
    }
  }

  const config = await demoApi();
  const team = config ? await demoTeam(config) : undefined;
  if (!HANDLE.test(handle) || !team?.includes(handle)) return new Response(null, { status: 422 });
  const response = goTo(next);
  response.cookies.set(SESSION_COOKIE, handle, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}
