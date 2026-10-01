import type { NextRequest } from "next/server";
import { consoleBackend } from "@/lib/console-backend";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// DELETE /api/console/sessions/[id] -> kill terminal.
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const denied = await requireSession();
  if (denied) return denied;
  const { id } = await ctx.params;
  return consoleBackend(request, `/api/console/sessions/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}
