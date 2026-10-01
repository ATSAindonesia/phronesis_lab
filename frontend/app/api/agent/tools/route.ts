import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// Daftar tool agent + flag needs_approval — untuk checklist di UI mode Agent.
const PLATFORM_URL =
  process.env.API_URL ??
  process.env.BUILDER_API_URL ??
  "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/agent/tools`,
      { headers: { "X-API-Key": API_KEY }, cache: "no-store" }
    );
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      return NextResponse.json(parsed ?? { error: `Agent tools failed (${res.status})` }, {
        status: res.status,
      });
    }
    return NextResponse.json(parsed);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not reach agent API: ${msg}` },
      { status: 502 }
    );
  }
}
