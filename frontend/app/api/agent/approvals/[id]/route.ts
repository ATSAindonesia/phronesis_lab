import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// Proxy keputusan approval: /api/agent/approvals/[id] -> backend.
// Dipakai modal approval di mode Agent (Approve/Reject perintah shell).
const PLATFORM_URL =
  process.env.API_URL ??
  process.env.BUILDER_API_URL ??
  "http://localhost:8081";
const API_KEY = process.env.BUILDER_API_KEY ?? "lab-local";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function POST(request: Request, ctx: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `${PLATFORM_URL.replace(/\/+$/, "")}/v1/agent/approvals/${encodeURIComponent(id)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": API_KEY },
        body: JSON.stringify(body),
        cache: "no-store",
      }
    );
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      return NextResponse.json(parsed ?? { error: `Approval failed (${res.status})` }, {
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
