import { NextRequest, NextResponse } from "next/server";

// Gate the admin panel UI behind the login cookie. Cookie *presence* is checked at
// the edge; the cookie is httpOnly and unforgeable token-wise (validated against
// admin_sessions in /api/admin/me and server helpers). The mobile API (/api/v1/*)
// and the admin auth endpoints (/api/admin/*) are intentionally left open here.
const PUBLIC_PREFIXES = ["/login", "/api", "/_next", "/favicon", "/globals.css"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const hasSession = Boolean(request.cookies.get("admin_session")?.value);
  if (!hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|css|js)$).*)"]
};
