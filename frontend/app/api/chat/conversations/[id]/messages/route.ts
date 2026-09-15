import type { NextRequest } from "next/server";
import { chatBackend } from "@/lib/chat-history";

export const dynamic = "force-dynamic";

// POST /api/chat/conversations/[id]/messages — simpan batch pesan
// { messages: [{ role, content, reasoning? }] } (user + assistant).
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  return chatBackend(
    request,
    `/v1/chat/conversations/${encodeURIComponent(id)}/messages`,
    { method: "POST", body }
  );
}
