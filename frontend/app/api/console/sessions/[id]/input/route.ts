import type { NextRequest } from "next/server";
import { consoleBackend } from "@/lib/console-backend";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/console/sessions/[id]/input {data: base64} -> tulis ke PTY.
export async function POST(request: NextRequest, ctx: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  return consoleBackend(request, `/api/console/sessions/${encodeURIComponent(id)}/input`, {
    method: "POST",
    body,
  });
}
