import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const PLATFORM_URL =
  process.env.BUILDER_API_URL ?? "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

interface Params {
  params: Promise<{ sessionId: string }>;
}

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  let body: { message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = body.message?.trim() ?? "";
  if (!message) {
    return NextResponse.json({ error: "Message is required." }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/sessions/${sessionId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ message }),
      }
    );
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: text || "Builder API failed" },
        { status: res.status }
      );
    }
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not reach builder API: ${msg}` },
      { status: 502 }
    );
  }
}
