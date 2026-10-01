import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

export async function GET() {
  const denied = await requireSession();
  if (denied) return denied;
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
