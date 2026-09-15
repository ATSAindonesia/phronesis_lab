import type { NextRequest } from "next/server";

// Helper buat endpoint riwayat chat: baca cookie session (JWT) lalu
// teruskan sebagai Authorization: Bearer ke Go backend, pola sama
// dengan proxy /api/chat (X-API-Key dari env server-side).

const PLATFORM_URL = process.env.BUILDER_API_URL ?? "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

export function sessionToken(request: NextRequest): string | null {
  return request.cookies.get("session")?.value ?? null;
}

export async function chatBackend(
  request: NextRequest,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<Response> {
  const token = sessionToken(request);
  if (!token) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const res = await fetch(`${PLATFORM_URL.replace(/\/+$/, "")}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
    });

    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // bukan JSON — diperlakukan sebagai error text di bawah
    }

    if (!res.ok) {
      const errObj =
        parsed && typeof parsed === "object" && "error" in parsed
          ? parsed
          : { error: text || `Chat history API failed (${res.status})` };
      return Response.json(errObj, { status: res.status });
    }

    return Response.json(parsed, { status: res.status });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return Response.json(
      { error: `Could not reach chat API: ${msg}` },
      { status: 502 }
    );
  }
}
