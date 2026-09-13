import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const API_URL = process.env.API_URL ?? "http://localhost:8080";

interface FileItem {
  name: string;
  language: string;
  content: string;
}

export async function POST(request: Request) {
  let body: { prompt?: string; files?: Record<string, FileItem>; stream?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const prompt = body.prompt?.trim() || "Modern UI Component";
  const currentFiles = body.files || {};
  const isStream = body.stream !== false; // Default to streaming for Bolt-like behavior

  try {
    const res = await fetch(`${API_URL}/api/experiments/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: isStream ? "text/event-stream" : "application/json",
      },
      body: JSON.stringify({ prompt, files: currentFiles }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error || "Backend generator failed", details: errData },
        { status: res.status }
      );
    }

    if (isStream && res.body) {
      return new Response(res.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Could not connect to Go backend generator: ${msg}` },
      { status: 502 }
    );
  }
}
