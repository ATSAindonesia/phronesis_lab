import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const session = request.cookies.get("session");

  if (!session?.value) {
    const url = new URL("/login", request.url);
    return NextResponse.redirect(url);
  }

  // Jika sudah login dan mengakses root "/", arahkan ke /lab
  if (request.nextUrl.pathname === "/") {
    const url = new URL("/lab", request.url);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/lab/:path*"],
};
