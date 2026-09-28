"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  Terminal as TerminalIcon,
  Plus,
  X,
  Trash2,
  RefreshCw,
  Loader2,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Kontrak API ─────────────────────────────────────────────────────────────

interface ConsoleSession {
  id: string;
  created_at: string;
  cols: number;
  rows: number;
  last_io_ms: number;
  exited: boolean;
  exit_code?: number;
}

type TabStatus = "connecting" | "live" | "reconnecting" | "exited";

const MAX_TABS = 5;

// ─── Base64 UTF-8 aman ───────────────────────────────────────────────────────

function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function b64decode(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ─── Terminal per tab ────────────────────────────────────────────────────────

function ConsoleTerminal({
  session,
  active,
  onStatus,
}: {
  session: ConsoleSession;
  active: boolean;
  onStatus: (id: string, st: TabStatus) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<{
    term: Terminal;
    fit: FitAddon;
    es: EventSource | null;
    disposed: boolean;
    errCount: number;
    retry: ReturnType<typeof setTimeout> | null;
  } | null>(null);
  const onStatusRef = useRef(onStatus);
  useEffect(() => {
    onStatusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    if (!containerRef.current) return;
    const sessionId = session.id;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      theme: {
        background: "#09090b",
        foreground: "#e4e4e7",
        cursor: "#f59e0b",
        selectionBackground: "rgba(245,158,11,0.3)",
        black: "#18181b",
        red: "#fb7185",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#93c5fd",
        magenta: "#d6d3d1",
        cyan: "#67e8f9",
        white: "#f4f4f5",
        brightBlack: "#52525b",
        brightRed: "#fda4af",
        brightGreen: "#6ee7b7",
        brightYellow: "#fcd34d",
        brightBlue: "#bfdbfe",
        brightMagenta: "#e7e5e4",
        brightCyan: "#a5f3fc",
        brightWhite: "#ffffff",
      },
      convertEol: false,
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    try {
      fit.fit();
    } catch {
      // container belum visible — fit ulang saat tab aktif
    }

    const st = {
      term,
      fit,
      es: null as EventSource | null,
      disposed: false,
      errCount: 0,
      retry: null as ReturnType<typeof setTimeout> | null,
    };
    stateRef.current = st;

    const postResize = () => {
      if (st.disposed || term.cols < 2 || term.rows < 2) return;
      fetch(`/api/console/sessions/${encodeURIComponent(sessionId)}/resize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols: term.cols, rows: term.rows }),
      }).catch(() => {});
    };

    const fitAndResize = () => {
      try {
        const before = { cols: term.cols, rows: term.rows };
        fit.fit();
        if (term.cols !== before.cols || term.rows !== before.rows) postResize();
      } catch {
        // abaikan saat hidden/detached
      }
    };

    // Input user -> backend PTY. Di-batch 30ms: mengetik cepat = 1 POST
    // gabungan, bukan 1 POST per huruf (penting di link lambat/tunnel).
    let pending = "";
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushInput = () => {
      flushTimer = null;
      if (st.disposed || pending === "") return;
      const text = pending;
      pending = "";
      fetch(`/api/console/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: b64encode(text) }),
      }).catch(() => {});
    };
    const dataDisp = term.onData((data) => {
      if (st.disposed) return;
      pending += data;
      if (pending.length > 4096) {
        if (flushTimer) clearTimeout(flushTimer);
        flushInput();
        return;
      }
      if (!flushTimer) flushTimer = setTimeout(flushInput, 30);
    });

    const connect = () => {
      if (st.disposed) return;
      st.es?.close();
      onStatusRef.current(sessionId, "connecting");
      const es = new EventSource(
        `/api/console/sessions/${encodeURIComponent(sessionId)}/stream`
      );
      st.es = es;

      es.addEventListener("scrollback", (ev) => {
        try {
          const { data } = JSON.parse((ev as MessageEvent).data) as { data: string };
          term.write(b64decode(data));
        } catch {
          // abaikan
        }
      });
      es.addEventListener("output", (ev) => {
        try {
          const { data } = JSON.parse((ev as MessageEvent).data) as { data: string };
          st.errCount = 0;
          onStatusRef.current(sessionId, "live");
          term.write(b64decode(data));
        } catch {
          // abaikan
        }
      });
      es.addEventListener("exit", (ev) => {
        let code = 0;
        try {
          code = (JSON.parse((ev as MessageEvent).data) as { code: number }).code ?? 0;
        } catch {
          // abaikan
        }
        es.close();
        if (st.es === es) st.es = null;
        term.writeln(`\r\n\x1b[1;31m[console] proses shell berakhir (exit ${code}) — sesi tetap memakai slot sampai tab ditutup.\x1b[0m`);
        onStatusRef.current(sessionId, "exited");
      });
      es.onerror = () => {
        es.close();
        if (st.es === es) st.es = null;
        if (st.disposed) return;
        st.errCount += 1;
        onStatusRef.current(sessionId, "reconnecting");
        if (st.retry) clearTimeout(st.retry);
        st.retry = setTimeout(() => {
          if (!st.disposed) connect();
        }, Math.min(2000 * st.errCount, 8000));
      };
    };

    connect();
    // Sinkron ukuran awal setelah font/container stabil.
    const initT = setTimeout(fitAndResize, 150);

    const ro = new ResizeObserver(fitAndResize);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      flushInput();
      st.disposed = true;
      clearTimeout(initT);
      if (st.retry) clearTimeout(st.retry);
      dataDisp.dispose();
      ro.disconnect();
      st.es?.close();
      st.es = null;
      term.dispose();
      stateRef.current = null;
    };
  }, [session.id]);

  // Saat tab menjadi aktif (sebelumnya hidden), fit ulang.
  useEffect(() => {
    if (!active) return;
    const st = stateRef.current;
    if (!st) return;
    const t = setTimeout(() => {
      try {
        const before = { cols: st.term.cols, rows: st.term.rows };
        st.fit.fit();
        if (st.term.cols !== before.cols || st.term.rows !== before.rows) {
          fetch(`/api/console/sessions/${encodeURIComponent(session.id)}/resize`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cols: st.term.cols, rows: st.term.rows }),
          }).catch(() => {});
        }
      } catch {
        // abaikan
      }
    }, 50);
    return () => clearTimeout(t);
  }, [active, session.id]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-zinc-950 p-2" />;
}

// ─── Halaman ─────────────────────────────────────────────────────────────────

export default function ConsolePage() {
  const [tabs, setTabs] = useState<ConsoleSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [statusById, setStatusById] = useState<Record<string, TabStatus>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const tabsRef = useRef<ConsoleSession[]>([]);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const onStatus = useCallback((id: string, st: TabStatus) => {
    setStatusById((m) => (m[id] === st ? m : { ...m, [id]: st }));
  }, []);

  // Mount: reattach sesi backend yang masih hidup.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/console/sessions", { cache: "no-store" });
        if (!res.ok) throw new Error(`list ${res.status}`);
        const data = (await res.json()) as { sessions: ConsoleSession[] };
        if (cancelled) return;
        const sessions = (data.sessions ?? []).slice(0, MAX_TABS);
        setTabs(sessions);
        setStatusById(Object.fromEntries(sessions.map((s) => [s.id, "connecting" as TabStatus])));
        if (sessions.length > 0) setActiveId(sessions[0].id);
      } catch {
        if (!cancelled) setNotice("Gagal memuat sesi terminal. Coba muat ulang halaman.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addTerminal = async () => {
    if (tabsRef.current.length >= MAX_TABS || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/console/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cols: 80, rows: 24 }),
        cache: "no-store",
      });
      if (res.status === 409) {
        setNotice("Maksimal 5 terminal tercapai. Tutup salah satu untuk membuka yang baru.");
        return;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`create ${res.status}: ${text.slice(0, 160) || res.statusText}`);
      }
      const data = (await res.json()) as { session: ConsoleSession };
      setTabs((t) => [...t, data.session]);
      setStatusById((m) => ({ ...m, [data.session.id]: "connecting" }));
      setActiveId(data.session.id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Gagal membuka terminal baru.");
    } finally {
      setBusy(false);
    }
  };

  const killTab = async (id: string) => {
    const tab = tabsRef.current.find((t) => t.id === id);
    const exited = tab?.exited || statusById[id] === "exited";
    if (!exited && !window.confirm("Tutup terminal ini? Proses shell di dalamnya akan di-kill.")) {
      return;
    }
    try {
      await fetch(`/api/console/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      // tetap hapus tab lokal walau backend gagal
    }
    setTabs((t) => {
      const next = t.filter((x) => x.id !== id);
      if (activeId === id) setActiveId(next.length > 0 ? next[next.length - 1].id : null);
      return next;
    });
    setStatusById((m) => {
      if (!(id in m)) return m;
      const rest = { ...m };
      delete rest[id];
      return rest;
    });
  };

  const activeTab = tabs.find((t) => t.id === activeId) ?? null;
  const full = tabs.length >= MAX_TABS;

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-paper">
      {/* Top bar */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-background/80 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon className="h-4 w-4 shrink-0 text-gold-ink" />
          <span className="label-caps hidden sm:inline">Console</span>
          <span className="font-mono text-[11px] text-faint">
            {tabs.length}/{MAX_TABS} terminal
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />}
          <button
            type="button"
            title={full ? "Maksimal 5 terminal" : "Terminal baru"}
            disabled={full || busy}
            onClick={addTerminal}
            className="inline-flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Terminal</span>
          </button>
        </div>
      </div>

      {/* Tab strip */}
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line bg-card px-3 py-2">
        {tabs.map((t, i) => {
          const st = statusById[t.id] ?? "connecting";
          const isActive = t.id === activeId;
          return (
            <div
              key={t.id}
              className={cn(
                "group flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors",
                isActive
                  ? "border-gold/50 bg-accent font-medium text-ink"
                  : "border-line text-muted hover:bg-accent/50 hover:text-ink"
              )}
            >
              <button
                type="button"
                onClick={() => setActiveId(t.id)}
                className="flex cursor-pointer items-center gap-2"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    st === "live" && "bg-emerald-500",
                    st === "connecting" && "animate-pulse bg-blue-500",
                    st === "reconnecting" && "animate-pulse bg-amber-500",
                    st === "exited" && "bg-red-500"
                  )}
                  title={st}
                />
                <span className="font-mono">term-{i + 1}</span>
                {st === "exited" && (
                  <span className="font-mono text-[10px] text-red-500">exited</span>
                )}
              </button>
              <button
                type="button"
                title={st === "exited" ? "Hapus sesi" : "Kill terminal"}
                onClick={() => killTab(t.id)}
                className="rounded p-0.5 text-faint transition-colors hover:bg-line hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {tabs.length === 0 && !loading && (
          <span className="font-mono text-[11px] text-faint">
            belum ada terminal — tekan + Terminal
          </span>
        )}
      </div>

      {notice && (
        <div className="mx-4 mt-3 flex shrink-0 items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="cursor-pointer text-amber-600 hover:text-amber-800 dark:text-amber-400"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Terminal area */}
      <div className="relative min-h-0 flex-1 bg-zinc-950">
        {loading ? (
          <div className="flex h-full items-center justify-center gap-2 font-mono text-xs text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin text-gold" /> memuat sesi…
          </div>
        ) : tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-full border border-zinc-800 bg-zinc-900 text-zinc-500">
              <TerminalIcon className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <h3 className="font-display text-sm font-medium text-zinc-200">
                Belum ada terminal
              </h3>
              <p className="max-w-xs text-xs leading-relaxed text-zinc-500">
                Buka hingga {MAX_TABS} terminal lokal (bash di PROJECT_ROOT). Sesi tetap
                hidup di backend walau halaman di-refresh — tutup tab untuk kill.
              </p>
            </div>
            <button
              type="button"
              onClick={addTerminal}
              className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-zinc-100 px-4 py-2 text-xs font-medium text-zinc-900 transition-colors hover:bg-white"
            >
              <Plus className="h-3.5 w-3.5" /> Buka terminal
            </button>
          </div>
        ) : (
          tabs.map((t) => (
            <div
              key={t.id}
              className={cn("h-full w-full", t.id === activeId ? "block" : "hidden")}
            >
              <ConsoleTerminal session={t} active={t.id === activeId} onStatus={onStatus} />
            </div>
          ))
        )}

        {/* Reconnect button overlay saat stream putus */}
        {activeTab && statusById[activeTab.id] === "reconnecting" && (
          <button
            type="button"
            onClick={() => {
              // force remount terminal aktif: tutup lalu buka ulang key
              const id = activeTab.id;
              setActiveId(null);
              setTimeout(() => setActiveId(id), 100);
            }}
            className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-zinc-900/90 px-3 py-2 font-mono text-[11px] text-amber-300 backdrop-blur transition-colors hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> reconnect stream
          </button>
        )}
      </div>

      {/* Footer info */}
      <div className="flex h-8 shrink-0 items-center gap-2 border-t border-line bg-card px-4 font-mono text-[10px] text-faint">
        <Trash2 className="h-3 w-3" />
        <span>
          sesi tersimpan di backend · refresh tidak mematikan · hilang saat backend restart ·
          sesi exited tetap memakai slot sampai tab ditutup
        </span>
      </div>
    </div>
  );
}
