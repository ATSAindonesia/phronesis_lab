import type { NextRequest } from "next/server";
import { consoleBackend } from "@/lib/console-backend";
import { requireSession } from "@/lib/require-session";

export const dynamic = "force-dynamic";

// GET /api/console/sessions -> list (untuk reattach).
export async function GET(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  return consoleBackend(request, "/api/console/sessions");
}

// POST /api/console/sessions {cols,rows} -> buat terminal (maks 5, else 409).
export async function POST(request: NextRequest) {
  const denied = await requireSession();
  if (denied) return denied;
  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  return consoleBackend(request, "/api/console/sessions", { method: "POST", body });
}
