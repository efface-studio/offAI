import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, gateMode, isValidSession } from "./lib/auth";

export async function proxy(request: NextRequest) {
  const mode = gateMode();
  if (mode === "open") return NextResponse.next();
  if (request.nextUrl.pathname === "/login") return NextResponse.next();
  if (mode === "password" && (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.next();
  }
  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = "";
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
