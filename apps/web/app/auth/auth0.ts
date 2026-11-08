import { Auth0Client } from "@auth0/nextjs-auth0/server";

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
