import { NextResponse } from "next/server";
import { SESSION_MAX_AGE_SECS } from "@/lib/session";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { email, password } = body;
  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: (data as { error?: string }).error ?? "Login failed" },
      { status: res.status }
    );
  }

  const data = await res.json();
  const token = (data as { token: string }).token;

  // Umur cookie SELALU sama dengan umur JWT backend (12 jam, lihat
  // lib/session.ts). Tidak ada "remember me" terpisah.
  const response = NextResponse.json({ ok: true });
  response.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECS,
  });

  return response;
}
