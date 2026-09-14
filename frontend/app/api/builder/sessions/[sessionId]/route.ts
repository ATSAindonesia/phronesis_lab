import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const PLATFORM_URL =
  process.env.BUILDER_API_URL ?? "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

interface Params {
  params: Promise<{ sessionId: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { sessionId } = await params;
  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/sessions/${sessionId}`,
      { headers: { "X-API-Key": API_KEY }, cache: "no-store" }
    );
    const text = await res.text();
    if (!res.ok) {
      return NextResponse.json(
        { error: "Session not found." },
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
