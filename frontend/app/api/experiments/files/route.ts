import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

export async function GET() {
  try {
    const res = await fetch(`${API_URL}/api/experiments/files`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ success: false, files: {} }, { status: res.status });
  } catch {
    return NextResponse.json({ success: false, files: {} }, { status: 500 });
  }
}
