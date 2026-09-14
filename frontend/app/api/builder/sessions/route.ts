import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Proxy ke builder API (Go backend /v1/*). Backend cuma butuh header
// X-API-Key non-empty; key disimpan di env frontend dan tidak pernah
// sampai ke browser.
const PLATFORM_URL =
  process.env.BUILDER_API_URL ?? "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

function upstream(path: string) {
  return `${PLATFORM_URL.replace(/\/+$/, "")}${path}`;
}

export async function POST(request: Request) {
  let body: { prompt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  if (!prompt) {
    return NextResponse.json({ error: "Prompt is required." }, { status: 400 });
  }

  try {
    const res = await fetch(upstream("/v1/sessions"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
      },
      body: JSON.stringify({ prompt, user_id: "lab-user" }),
    });

    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: text || "Builder API failed" },
        { status: res.status }
      );
    }

    const data = JSON.parse(text) as { session?: { id?: string } };
    const sessionId = data.session?.id ?? "";
    // SSE lewat proxy Next juga, biar bisa diakses dari device lain (LAN/Tailscale).
    return NextResponse.json({
      session: data.session,
      eventsUrl: sessionId
        ? `/api/builder/sessions/${sessionId}/events?api_key=${encodeURIComponent(API_KEY)}`
        : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not reach builder API: ${msg}` },
      { status: 502 }
    );
  }
}
