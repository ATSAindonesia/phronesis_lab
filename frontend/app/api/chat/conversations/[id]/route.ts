import type { NextRequest } from "next/server";
import { chatBackend } from "@/lib/chat-history";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/chat/conversations/[id] — detail percakapan + semua pesannya.
export async function GET(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return chatBackend(
    request,
    `/v1/chat/conversations/${encodeURIComponent(id)}`
  );
}

// PATCH /api/chat/conversations/[id] — ganti judul { title: string }.
export async function PATCH(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  return chatBackend(
    request,
    `/v1/chat/conversations/${encodeURIComponent(id)}`,
    { method: "PATCH", body }
  );
}

// DELETE /api/chat/conversations/[id] — hapus percakapan (+ pesannya).
export async function DELETE(request: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  return chatBackend(
    request,
    `/v1/chat/conversations/${encodeURIComponent(id)}`,
    { method: "DELETE" }
  );
}
