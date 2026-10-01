import type { NextRequest } from "next/server";
import { chatBackend } from "@/lib/chat-history";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// GET /api/chat/conversations — daftar riwayat percakapan user.
export async function GET(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  return chatBackend(request, "/v1/chat/conversations");
}

// POST /api/chat/conversations — buat percakapan baru { title?: string }.
export async function POST(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return chatBackend(request, "/v1/chat/conversations", {
    method: "POST",
    body,
  });
}
