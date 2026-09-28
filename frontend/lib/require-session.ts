import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSessionAlive } from "./session";

// requireSession: gate data-plane untuk semua proxy /api/* (kecuali
// login/logout/session). Kembalikan null bila sesi valid, atau respons
// 401 bila tidak. Frontend mengarahkan 401 ini ke /login secara global.
//
// Pola pakai di awal setiap handler:
//   const denied = await requireSession();
//   if (denied) return denied;
export async function requireSession(): Promise<NextResponse | null> {
  const store = await cookies();
  const token = store.get("session")?.value;
  if (!isSessionAlive(token)) {
    return NextResponse.json({ error: "session expired" }, { status: 401 });
  }
  return null;
}
