"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// Tab ditinggal < ini dianggap singgah sebentar -> skip cek session.
const MIN_HIDDEN_MS = 30_000;
// Jeda minimum antar cek biar focus beruntun tidak spam /api/session.
const MIN_CHECK_INTERVAL_MS = 10_000;
// Poll berkala: tendangan tegas maksimal selebar ini setelah session habis,
// bahkan tanpa navigasi dan tanpa event tab. (Middleware menjaga navigasi,
// guard proxy menjaga data — watcher menjaga waktu.)
const POLL_INTERVAL_MS = 30_000;

type SessionStatus = {
  authenticated: boolean;
  expired?: boolean;
};

export default function SessionTabWatcher() {
  const router = useRouter();
  const hiddenAtRef = useRef<number | null>(null);
  const lastCheckRef = useRef(0);
  const checkingRef = useRef(false);
  const redirectedRef = useRef(false);

  useEffect(() => {
    async function checkSession() {
      if (checkingRef.current || redirectedRef.current) return;
      // Throttle: abaikan cek yang terlalu rapat.
      const now = Date.now();
      if (now - lastCheckRef.current < MIN_CHECK_INTERVAL_MS) return;
      lastCheckRef.current = now;
      checkingRef.current = true;

      try {
        const res = await fetch("/api/session", {
          method: "GET",
          cache: "no-store",
          credentials: "same-origin",
        });
        // 5xx / network blip bukan bukti expired -> diam saja.
        if (!res.ok && res.status !== 401) return;
        const data = (await res.json().catch(() => null)) as SessionStatus | null;
        if (!data || data.authenticated !== true || data.expired === true) {
          redirectedRef.current = true;
          router.push("/login");
          router.refresh();
        }
      } catch {
        // Network error: jangan tendang user, tunggu cek berikutnya.
      } finally {
        checkingRef.current = false;
      }
    }

    function handleBecameHidden() {
      hiddenAtRef.current = Date.now();
    }

    function handleBecameVisible() {
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      // Hanya cek jika tab sempat ditinggal cukup lama.
      // Tanpa ini, setiap Alt-Tab cepat kena 1 request sia-sia.
      if (hiddenAt === null) return;
      if (Date.now() - hiddenAt < MIN_HIDDEN_MS) return;
      void checkSession();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") {
        handleBecameHidden();
      } else {
        handleBecameVisible();
      }
    }

    function onBlur() {
      handleBecameHidden();
    }

    function onFocus() {
      // focus tanpa visibilitychange (pindah aplikasi) tetap ke-cover.
      if (document.visibilityState === "visible") handleBecameVisible();
    }

    function onPageShow(e: PageTransitionEvent) {
      // Kembali via bfcache: cookie/JWT bisa sudah expired selama pergi.
      if (e.persisted) void checkSession();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onPageShow);
    const poll = window.setInterval(() => {
      void checkSession();
    }, POLL_INTERVAL_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onPageShow);
      window.clearInterval(poll);
    };
  }, [router]);

  return null;
}
