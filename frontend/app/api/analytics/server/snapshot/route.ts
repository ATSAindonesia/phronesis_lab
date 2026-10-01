import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// Snapshot proxy: /api/analytics/server/snapshot -> backend (satu sampel JSON,
// dipakai untuk first paint + fallback polling saat SSE terputus).
const BACKEND_URL =
  process.env.API_URL ??
  process.env.BUILDER_API_URL ??
  "http://localhost:8081";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
  try {
    const res = await fetch(
      `${BACKEND_URL.replace(/\/+$/, "")}/api/analytics/server/snapshot`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    const text = await res.text();
    // Teruskan body backend apa adanya (termasuk 404 text "page not found"
    // dari binary lama) agar diagnosis tidak tertutup.
    const contentType = res.headers.get("content-type") ?? "application/json";
    if (!res.ok) {
      return new Response(text || `Analytics API failed (${res.status})`, {
        status: res.status,
        headers: { "Content-Type": contentType },
      });
    }
    return new Response(text, {
      status: res.status,
      headers: { "Content-Type": contentType },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not reach analytics API: ${msg}` },
      { status: 502 }
    );
  }
}
