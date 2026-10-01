// Helper session terpusat (dipakai middleware edge + route handler).
// Satu-satunya definisi umur session frontend: 12 jam, selaras dengan
// JWT backend (JWT_EXPIRY_MINUTES=720). Jangan hardcode umur di tempat lain.

export const SESSION_MAX_AGE_SECS = 12 * 60 * 60;

type TokenPayload = { exp?: number };

// decodePayload: edge-safe (tanpa Buffer). Klaim backend hanya ASCII
// (user_uuid/exp/iat) sehingga atob cukup.
function decodePayload(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(b64)) as TokenPayload;
  } catch {
    return null;
  }
}

export function getTokenExpiryMs(token: string): number | null {
  const payload = decodePayload(token);
  return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
}

// isSessionAlive: token harus berbentuk JWT dan belum lewat exp.
// Dipakai middleware (gate navigasi) dan require-session (gate data).
export function isSessionAlive(token: string | undefined | null): boolean {
  if (!token) return false;
  const expiresAt = getTokenExpiryMs(token);
  if (expiresAt === null) return false;
  return expiresAt > Date.now();
}
