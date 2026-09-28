import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";

const API_URL = process.env.API_URL ?? "http://localhost:8081";

export async function GET(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get("path") ?? "";

  try {
    const targetUrl = new URL(`${API_URL}/api/files/tree`);
    if (path) {
      targetUrl.searchParams.set("path", path);
    }

    const res = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return NextResponse.json(
        data ?? { error: { code: "TREE_ERROR", message: "Failed to fetch file tree" } },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message } },
      { status: 500 }
    );
  }
}
