import type { NextRequest } from "next/server";
import { consoleStream } from "@/lib/console-backend";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

// SSE proxy: output PTY backend -> EventSource browser.
// EventSource tidak bisa set header; auth dicek via cookie di consoleStream.
export async function GET(request: NextRequest, ctx: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  return consoleStream(request, `/api/console/sessions/${encodeURIComponent(id)}/stream`);
}
