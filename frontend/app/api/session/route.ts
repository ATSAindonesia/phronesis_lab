import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getTokenExpiryMs } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("session")?.value;
  if (!token) {
    return NextResponse.json(
      { authenticated: false, expired: true, reason: "missing" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  // Token bukan JWT yang valid -> anggap session rusak/expired.
  if (token.split(".").length !== 3) {
    return NextResponse.json(
      { authenticated: false, expired: true, reason: "malformed" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const expiresAt = getTokenExpiryMs(token);
  if (expiresAt !== null && expiresAt <= Date.now()) {
    return NextResponse.json(
      {
        authenticated: false,
        expired: true,
        reason: "expired",
        expiresAt: new Date(expiresAt).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  return NextResponse.json(
    {
      authenticated: true,
      expired: false,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
