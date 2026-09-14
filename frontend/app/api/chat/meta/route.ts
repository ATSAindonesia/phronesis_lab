import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Proxy meta chat (model + provider aktif) buat badge di UI.
const PLATFORM_URL = process.env.BUILDER_API_URL ?? "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

export async function GET() {
  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/chat/meta`,
      { headers: { "X-API-Key": API_KEY }, cache: "no-store" }
    );
    if (!res.ok) {
      return NextResponse.json(
        { error: `Chat API failed (${res.status})` },
        { status: res.status }
      );
    }
    return NextResponse.json(await res.json());
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not reach chat API: ${msg}` },
      { status: 502 }
    );
  }
}
