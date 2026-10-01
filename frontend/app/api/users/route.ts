import type { NextRequest } from "next/server";
import { chatBackend } from "@/lib/chat-history";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// Base: /api/users -> /v1/users (list & create). Segmen lebih dalam
// ditangani app/api/users/[...path]/route.ts.
export async function GET(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  return chatBackend(request, "/v1/users", { method: "GET" });
}

export async function POST(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return chatBackend(request, "/v1/users", { method: "POST", body });
}
