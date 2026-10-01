import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Proxy ke agent API (Go backend /v1/agent/chat). SSE passthrough (trace +
// token + [DONE]) — pola sama dengan proxy chat.
const PLATFORM_URL =
  process.env.API_URL ??
  process.env.BUILDER_API_URL ??
  "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

export async function POST(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/agent/chat`,
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
      try {
        const parsed = JSON.parse(text) as unknown;
        return NextResponse.json(parsed, { status: res.status });
      } catch {
        return NextResponse.json(
          { error: text || `Agent API failed (${res.status})` },
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
      { error: `Could not reach agent API: ${msg}` },
      { status: 502 }
    );
  }
}
