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
