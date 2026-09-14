import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Proxy ke chat API (Go backend /v1/chat). SSE passthrough biar bisa
// diakses dari device lain (LAN/Tailscale/domain) — pola sama dengan
// proxy builder.
const PLATFORM_URL = process.env.BUILDER_API_URL ?? "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/chat`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
          Accept: "text/event-stream",
        },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      // Backend ngirim JSON {"error": "..."} — forward apa adanya biar
      // gak dobel-wrap jadi string di dalam string.
      try {
        const parsed = JSON.parse(text) as unknown;
        return NextResponse.json(parsed, { status: res.status });
      } catch {
        return NextResponse.json(
          { error: text || `Chat API failed (${res.status})` },
          { status: res.status }
        );
      }
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
    return NextResponse.json(
      { error: `Could not reach chat API: ${msg}` },
      { status: 502 }
    );
  }
}
