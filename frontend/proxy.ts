import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isSessionAlive } from "./lib/session";

// Penengah tunggal session seluruh website lab (Next proxy = middleware).
// - Tanpa sesi valid (hilang/rusak/expired): semua halaman -> /login?next=...
//   (obat bug redirect nyasar: setelah login user kembali ke halaman semula).
// - Sesi valid membuka /login atau /: langsung -> /lab.
// API (/api/*) tidak lewat sini — dijaga per-route oleh require-session.
// Catatan: gate navigasi cek klaim exp; otoritas penuh tetap di backend
// (JWT middleware) + guard proxy require-session (data-plane).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get("session")?.value;
  const alive = isSessionAlive(token);
  const isLogin = pathname === "/login";

  if (!alive) {
    if (isLogin) return NextResponse.next();
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  if (isLogin || pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/lab";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/lab/:path*"],
};
