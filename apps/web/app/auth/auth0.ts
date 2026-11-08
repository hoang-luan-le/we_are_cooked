import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";

/**
 * Auth0 sign-in (Google). Active only when every setting is present; otherwise the app stays in demo mode
 * (the "Present as..." cookie), so local rehearsals and Tung's browser tests are unchanged.
 */
export function auth0Configured(): boolean {
  return ["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "AUTH0_AUDIENCE"]
    .every(name => Boolean(process.env[name]?.trim() && !process.env[name]?.trim().startsWith("#")));
}

export const auth0 = auth0Configured()
  ? new Auth0Client({
    // Ask for an access token for the Incident Lab API; the FastAPI backend verifies it (RS256, audience, issuer).
    authorizationParameters: { audience: process.env.AUTH0_AUDIENCE, scope: "openid profile email" },
    signInReturnToPath: "/home",
    // Same as the SDK default, but a failed sign-in is logged (code + cause) and shown on /session.
    onCallback: async (error, ctx) => {
      const base = ctx.appBaseUrl ?? process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
      if (error) {
        const code = (error as { code?: string }).code ?? "unknown";
        const cause = error.cause instanceof Error ? error.cause.message : "";
        console.error(`Auth0 sign-in failed: ${code}: ${error.message}${cause ? ` (cause: ${cause})` : ""}`);
        return NextResponse.redirect(new URL(`/session?error=signin_failed&reason=${encodeURIComponent(code)}`, base));
      }
      return NextResponse.redirect(new URL(ctx.returnTo || "/home", base));
    },
  })
  : undefined;

/** The signed-in person's API token, or undefined (not signed in, or the session expired). */
export async function accessToken(): Promise<string | undefined> {
  if (!auth0) return;
  try {
    const session = await auth0.getSession();
    if (!session) return;
    return (await auth0.getAccessToken()).token;
  } catch {
    return;
  }
}
