export function demoEnabled() {
  return process.env.NODE_ENV === "development" || process.env.NIGHT_FIXTURES === "1";
}

export function demoApi() {
  if (!demoEnabled()) return;
  try {
    const url = new URL(process.env.NIGHT_API_ORIGIN ?? "");
    if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || url.pathname !== "/") return;
    return { origin: url.origin, user: process.env.NIGHT_DEMO_USER || "demo-a" };
  } catch {
    return;
  }
}

export function teamEntryApi() {
  return process.env.NIGHT_TEAM_ENTRY === "1" ? demoApi() : undefined;
}

export async function fetchDemo(request: Request, config: NonNullable<ReturnType<typeof demoApi>>, path: string, body?: object) {
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
