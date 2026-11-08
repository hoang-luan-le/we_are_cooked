import { cookies } from "next/headers";

export function demoEnabled() {
  return process.env.NODE_ENV === "development" || process.env.NIGHT_FIXTURES === "1";
}

/** The local API and who is using the app right now. */
export type DemoConfig = { origin: string; user: string };

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

export async function demoApi(): Promise<DemoConfig | undefined> {
  if (!demoEnabled()) return;
  let origin: string;
  try {
    const url = new URL(process.env.NIGHT_API_ORIGIN ?? "");
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") return;
    origin = url.origin;
  } catch {
    return;
  }
  return { origin, user: (await sessionUser()) ?? (process.env.NIGHT_DEMO_USER || "demo-a") };
}

export async function teamEntryApi(): Promise<DemoConfig | undefined> {
  return process.env.NIGHT_TEAM_ENTRY === "1" ? demoApi() : undefined;
}

export async function fetchDemo(request: Request, config: DemoConfig, path: string, body?: object) {
  return fetch(new URL(path, config.origin), {
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      "X-Demo-User": config.user,
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
