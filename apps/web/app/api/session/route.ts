import { NextResponse } from "next/server";
import { demoApi, HANDLE, SESSION_COOKIE } from "../../night/demo-config";
import { demoTeam, safeNext } from "../../session/session-api";

export const dynamic = "force-dynamic";

/** "Present as <handle>": sets the session cookie (demo mode only), then goes to `next`. Auth0 replaces this. */
export async function POST(request: Request) {
  const config = await demoApi();
  if (!config) return new Response(null, { status: 404 });
  const form = await request.formData().catch(() => null);
  const handle = String(form?.get("handle") ?? "").trim().toLowerCase();
  const next = safeNext(form?.get("next"));
  const team = await demoTeam(config);
  if (!HANDLE.test(handle) || !team?.includes(handle)) return new Response(null, { status: 422 });
  // Relative Location: stay on whatever host the browser used (127.0.0.1 vs localhost keep separate cookies).
  const response = new NextResponse(null, { status: 303, headers: { Location: next } });
  response.cookies.set(SESSION_COOKIE, handle, { httpOnly: true, sameSite: "lax", path: "/" });
  return response;
}
