import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8081";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const path = searchParams.get("path") ?? "";

  if (!path) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Path parameter is required" } },
      { status: 400 }
    );
  }

  try {
    const targetUrl = new URL(`${API_URL}/api/files/content`);
    targetUrl.searchParams.set("path", path);

    const res = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return NextResponse.json(
        data ?? { error: { code: "CONTENT_ERROR", message: "Failed to fetch file content" } },
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
