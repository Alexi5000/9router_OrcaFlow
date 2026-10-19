import { NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSettings } from "./lib/localDb";
import { getSessionSecret } from "./lib/sessionSecret";

const PUBLIC_API_PATHS = new Set([
  "/api/auth/login", "/api/auth/logout", "/api/settings/require-login",
  "/api/version", "/api/tags",
]);

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");
  const publicInference = pathname === "/api/v1" || pathname.startsWith("/api/v1/") || pathname.startsWith("/api/v1beta/");
  if (isApi && (PUBLIC_API_PATHS.has(pathname) || publicInference)) return NextResponse.next();

  if (pathname.startsWith("/dashboard") || isApi) {
    if (isApi && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== request.nextUrl.origin) {
        return NextResponse.json({ error: "Cross-origin management request rejected" }, { status: 403 });
      }
    }
    try {
      const settings = await getSettings();
      if (settings.requireLogin === false) return NextResponse.next();
      const token = request.cookies.get("auth_token")?.value;
      if (token) {
        const { payload } = await jwtVerify(token, getSessionSecret(), { algorithms: ["HS256"] });
        if (payload.authenticated === true) return NextResponse.next();
      }
    } catch {}
    if (isApi) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/") return NextResponse.redirect(new URL("/dashboard", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/", "/dashboard/:path*", "/api/:path*"] };
