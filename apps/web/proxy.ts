import { NextResponse } from "next/server";
import { auth0 } from "./app/auth/auth0";

/**
 * Next.js 16 proxy (formerly middleware). With Auth0 configured it serves /auth/login, /auth/callback,
 * /auth/logout and keeps the session rolling. In demo mode it does nothing.
 */
export async function proxy(request: Request) {
  if (!auth0) return NextResponse.next();
  return await auth0.middleware(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)"],
};
