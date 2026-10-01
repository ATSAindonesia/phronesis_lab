import type { NextRequest } from "next/server";
import { consoleBackend } from "@/lib/console-backend";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/console/sessions/[id]/resize {cols,rows}.
export async function POST(request: NextRequest, ctx: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return consoleBackend(request, `/api/console/sessions/${encodeURIComponent(id)}/resize`, {
    method: "POST",
    body,
  });
}
