import type { NextRequest } from "next/server";
import { sessionToken } from "@/lib/chat-history";

// Helper proxy console: verifikasi cookie `session` (JWT) milik user yang
// login, lalu teruskan ke backend Go dengan X-API-Key server-side.
// JWT tidak pernah dikirim ke browser ni dibuka ke client-side JS.
const BACKEND_URL =
  process.env.API_URL ??
  process.env.BUILDER_API_URL ??
  "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

function authed(request: NextRequest): Response | null {
  if (!sessionToken(request)) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  return null;
}

export async function consoleBackend(
  request: NextRequest,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response> {
  const denied = authed(request);
  if (denied) return denied;

  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/+$/, "")}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });
    const text = await res.text();
    const ct = res.headers.get("content-type") ?? "application/json";
    return new Response(text, { status: res.status, headers: { "Content-Type": ct } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Could not reach console API: ${msg}` }, { status: 502 });
  }
}

export async function consoleStream(
  request: NextRequest,
  path: string
): Promise<Response> {
  const denied = authed(request);
  if (denied) return denied;

  try {
    const res = await fetch(`${BACKEND_URL.replace(/\/+$/, "")}${path}`, {
      headers: { "X-API-Key": API_KEY, Accept: "text/event-stream" },
      cache: "no-store",
    });
    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return new Response(text || `Console stream failed (${res.status})`, {
        status: res.status,
      });
    }
    return new Response(res.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Could not reach console stream: ${msg}` }, { status: 502 });
  }
}
