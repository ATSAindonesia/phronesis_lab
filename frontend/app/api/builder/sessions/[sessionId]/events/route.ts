import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// SSE proxy: /api/builder/sessions/[id]/events -> backend /v1/sessions/[id]/events
// EventSource tidak bisa set header, jadi api_key diterusin via query di sini.
const PLATFORM_URL = process.env.BUILDER_API_URL ?? "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

interface Params {
  params: Promise<{ sessionId: string }>;
}

export async function GET(request: Request, { params }: Params) {
  const { sessionId } = await params;
  const url = new URL(request.url);
  const key = url.searchParams.get("api_key") ?? API_KEY;

  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/sessions/${sessionId}/events`,
      {
        headers: { "X-API-Key": key, Accept: "text/event-stream" },
        cache: "no-store",
      }
    );

    if (!res.ok || !res.body) {
      return NextResponse.json(
        { error: `Builder API stream failed (${res.status})` },
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
      { error: `Could not reach builder API stream: ${msg}` },
      { status: 502 }
    );
  }
}
