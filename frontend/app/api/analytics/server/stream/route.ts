import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// SSE proxy: /api/analytics/server/stream -> backend /api/analytics/server/stream
// EventSource tidak bisa set header, tapi endpoint ini publik (tanpa API key)
// mengikuti pola /api/files. Interval diteruskan via query.
const BACKEND_URL =
  process.env.API_URL ??
  process.env.BUILDER_API_URL ??
  "http://localhost:8081";

export async function GET(request: Request) {
  const denied = await requireSession();
  if (denied) return denied;
  const url = new URL(request.url);
  const intervalMs = url.searchParams.get("interval_ms") ?? "2000";

  const target = new URL(
    `${BACKEND_URL.replace(/\/+$/, "")}/api/analytics/server/stream`
  );
  target.searchParams.set("interval_ms", intervalMs);

  try {
    const res = await fetch(target.toString(), {
      headers: { Accept: "text/event-stream" },
      cache: "no-store",
    });

    if (!res.ok || !res.body) {
      return NextResponse.json(
        { error: `Analytics stream failed (${res.status})` },
        { status: res.status }
      );
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
      { error: `Could not reach analytics stream: ${msg}` },
      { status: 502 }
    );
  }
}
