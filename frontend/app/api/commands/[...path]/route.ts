import type { NextRequest } from "next/server";
import { chatBackend } from "@/lib/chat-history";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

// Proxy catch-all ke backend Go: /api/commands/<...> -> /v1/commands/<...>
// Cookie `session` (JWT) diteruskan sebagai Authorization: Bearer oleh
// helper chatBackend, pola sama dengan proxy riwayat chat.
async function forward(request: NextRequest, ctx: Ctx, method: string) {
  const { path } = await ctx.params;
  const target =
    "/v1/commands/" + (path ?? []).map((seg) => encodeURIComponent(seg)).join("/");

  if (method === "GET" || method === "DELETE") {
    return chatBackend(request, target, { method });
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return chatBackend(request, target, { method, body });
}

export async function GET(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "GET");
}

export async function POST(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "POST");
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "PATCH");
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  return forward(request, ctx, "DELETE");
}
