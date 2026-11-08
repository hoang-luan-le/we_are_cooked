import { cookies } from "next/headers";
import { cache } from "react";
import { accessToken, auth0Configured } from "../auth/auth0";

export function demoEnabled() {
  return process.env.NODE_ENV === "development" || process.env.NIGHT_FIXTURES === "1";
}

/** The local API, who is using the app right now, and the header that proves it to the backend. */
export type DemoConfig = { origin: string; user: string; headers: Record<string, string> };

/** Where the person is: demo mode (pick a handle) or Auth0 (signed out, needs a handle, or ready). */
export type SessionState =
  | { mode: "demo"; user: string }
  | { mode: "auth0"; signedIn: false }
  | { mode: "auth0"; signedIn: true; user: string | null; headers: Record<string, string> };

/** Session cookie: which demo handle this browser is signed in as (set on /session). Auth0 replaces it later. */
export const SESSION_COOKIE = "il_demo_user";
export const HANDLE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

async function sessionUser(): Promise<string | undefined> {
  try {
    const chosen = (await cookies()).get(SESSION_COOKIE)?.value;
    return chosen && HANDLE.test(chosen) ? chosen : undefined;
  } catch {
    return; // outside a request (e.g. build time): fall back to the configured user
  }
}

function apiOrigin(): string | undefined {
  try {
    const url = new URL(process.env.NIGHT_API_ORIGIN ?? "");
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") return;
    return url.origin;
  } catch {
    return;
  }
}

/** Auth0 mode: the handle this account claimed (GET /api/me), null if it hasn't picked one yet. */
async function claimedHandle(origin: string, headers: Record<string, string>): Promise<string | null | undefined> {
  try {
    const response = await fetch(new URL("/api/me", origin), {
      headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000),
    });
    if (response.ok) {
      const body: { handle?: string } = await response.json();
      return body.handle && HANDLE.test(body.handle) ? body.handle : null;
    }
    const body: { code?: string } = await response.json().catch(() => ({}));
    return body.code === "handle_required" ? null : undefined;
  } catch {
    return;
  }
}

/** Who is using the app (memoized per request). */
export const currentSession = cache(async (): Promise<SessionState | undefined> => {
  if (!demoEnabled()) return;
  const origin = apiOrigin();
  if (!origin) return;
  if (!auth0Configured()) {
    return { mode: "demo", user: (await sessionUser()) ?? (process.env.NIGHT_DEMO_USER || "demo-a") };
  }
  const token = await accessToken();
  if (!token) return { mode: "auth0", signedIn: false };
  const headers = { Authorization: `Bearer ${token}` };
  const user = await claimedHandle(origin, headers);
  return { mode: "auth0", signedIn: true, user: user ?? null, headers };
});

export async function demoApi(): Promise<DemoConfig | undefined> {
  const origin = apiOrigin();
  const session = await currentSession();
  if (!origin || !session) return;
  if (session.mode === "demo") return { origin, user: session.user, headers: { "X-Demo-User": session.user } };
  // Auth0: only once signed in and a handle is claimed; until then pages show the sign-in / handle steps.
  if (!session.signedIn || !session.user) return;
  return { origin, user: session.user, headers: session.headers };
}

export async function teamEntryApi(): Promise<DemoConfig | undefined> {
  return process.env.NIGHT_TEAM_ENTRY === "1" ? demoApi() : undefined;
}

export async function fetchDemo(request: Request, config: DemoConfig, path: string, body?: object) {
  return fetch(new URL(path, config.origin), {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...config.headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.any([request.signal, AbortSignal.timeout(6000)]),
  });
}

export function devRelayBase() {
  try {
    const url = new URL(process.env.DANA_DEV_WS_BASE ?? "");
    if (["ws:", "wss:"].includes(url.protocol) && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === "/") {
      return url.origin;
    }
  } catch {
    // The optional relay is absent or misconfigured. The scripted briefing still works.
  }
}
