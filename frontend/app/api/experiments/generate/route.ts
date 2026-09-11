import { NextResponse } from "next/server";

const API_URL = process.env.API_URL ?? "http://localhost:8080";

interface FileItem {
  name: string;
  language: string;
  content: string;
}

export async function POST(request: Request) {
  let body: { prompt?: string; files?: Record<string, FileItem> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() || "Modern UI Component";
  const currentFiles = body.files || {};

  try {
    // Forward request and existing files context to the Go backend LLM generator
    const res = await fetch(`${API_URL}/api/experiments/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, files: currentFiles }),
    });

    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }

    const errData = await res.json().catch(() => ({}));
    return NextResponse.json(
      { error: errData.error || "Backend generator failed", details: errData },
      { status: res.status }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not connect to Go backend generator: ${msg}` },
      { status: 502 }
    );
  }
}
