"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  Cpu,
  HardDrive,
  MemoryStick,
  Gauge,
  Clock,
  Pause,
  Play,
  RefreshCw,
  Server,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types (kontrak dengan backend internal/analytics) ───────────────────────

interface ServerStats {
  cpu_percent: number;
  mem_total_mb: number;
  mem_used_mb: number;
  mem_percent: number;
  disk_total_gb: number;
  disk_used_gb: number;
  disk_percent: number;
  load_1: number;
  load_5: number;
  load_15: number;
  uptime_sec: number;
  goroutines: number;
  degraded: boolean;
  timestamp: string;
}

type ConnStatus = "connecting" | "live" | "polling" | "error" | "paused" | "outdated";

const INTERVAL_MS = 2000;
const HISTORY_CAP = 60;
const MAX_SSE_ERRORS_BEFORE_POLLING = 3;
const RECONNECT_DELAY_MS = 3000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(totalSec: number): string {
  if (!Number.isFinite(totalSec) || totalSec < 0) return "—";
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = Math.floor(totalSec % 60);
  if (d > 0) return `${d}h ${h}j ${m}m`;
  if (h > 0) return `${h}j ${m}m ${s}d`;
  if (m > 0) return `${m}m ${s}d`;
  return `${s}d`;
}

function formatTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleTimeString("id-ID", { hour12: false });
}

function statusMeta(status: ConnStatus): { label: string; dot: string; pulse: boolean } {
  switch (status) {
    case "live":
      return { label: "LIVE", dot: "bg-emerald-500", pulse: true };
    case "polling":
      return { label: "POLLING", dot: "bg-amber-500", pulse: true };
    case "paused":
      return { label: "PAUSED", dot: "bg-zinc-400", pulse: false };
    case "connecting":
      return { label: "CONNECTING", dot: "bg-blue-500", pulse: true };
    case "error":
      return { label: "RECONNECTING", dot: "bg-red-500", pulse: true };
    case "outdated":
      return { label: "BACKEND OUTDATED", dot: "bg-amber-500", pulse: false };
  }
}

// ─── Sparkline (SVG murni, tanpa dependency chart) ───────────────────────────

function Sparkline({
  values,
  max,
  stroke = "currentColor",
}: {
  values: number[];
  max: number;
  stroke?: string;
}) {
  const W = 220;
  const H = 44;
  if (values.length < 2) {
    return (
      <div
        className="flex h-11 items-center justify-center font-mono text-[10px] text-faint"
        aria-label="Menunggu data"
      >
        menunggu data…
      </div>
    );
  }
  const lo = Math.min(...values);
  const hi = Math.max(max, ...values, lo + 1e-9);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (W - 4) + 2;
    const y = H - 4 - ((v - Math.min(lo, 0)) / (hi - Math.min(lo, 0) || 1)) * (H - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = pts[pts.length - 1].split(",");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-11 w-full"
      role="img"
      aria-label="Grafik tren"
      preserveAspectRatio="none"
    >
      <polyline
        points={pts.join(" ")}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={stroke} />
    </svg>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  title,
  big,
  sub,
  percent,
  values,
  sparkMax,
  accent,
}: {
  icon: React.ReactNode;
  title: string;
  big: string;
  sub: string;
  percent: number;
  values: number[];
  sparkMax: number;
  accent: string;
}) {
  const pct = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
  return (
    <div className="hairline-card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-panel", accent)}>
            {icon}
          </span>
          <span className="label-caps">{title}</span>
        </div>
        <span className="font-mono text-[11px] text-faint">{pct.toFixed(1)}%</span>
      </div>
      <div>
        <div className="font-display text-3xl font-medium tracking-tight text-ink">{big}</div>
        <div className="mt-1 font-mono text-[11px] text-muted">{sub}</div>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-panel">
        <div
          className="h-full rounded-full bg-gold transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={cn("text-gold-ink", accent)}>
        <Sparkline values={values} max={sparkMax} />
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function AnalyticsServerPage() {
  const [latest, setLatest] = useState<ServerStats | null>(null);
  const [history, setHistory] = useState<ServerStats[]>([]);
  const [status, setStatus] = useState<ConnStatus>("connecting");
  const [paused, setPaused] = useState(false);
  const [gen, setGen] = useState(0); // bump untuk force reconnect

  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errCountRef = useRef(0);
  const pausedRef = useRef(false);
  const outdatedRef = useRef(false);
  const connectRef = useRef<() => void>(() => {});

  // Sinkron ref pause di effect (bukan saat render).
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const pushSample = useCallback((s: ServerStats) => {
    setLatest(s);
    setHistory((h) => [...h.slice(-(HISTORY_CAP - 1)), s]);
  }, []);

  const stopAll = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    if (retryRef.current) clearTimeout(retryRef.current);
    retryRef.current = null;
  }, []);

  // Backend menjawab 404 = binary lama tanpa endpoint analytics.
  // Hentikan semua retry agar tidak reconnecting tanpa henti.
  const markOutdated = useCallback(() => {
    outdatedRef.current = true;
    stopAll();
    setStatus("outdated");
  }, [stopAll]);

  const startPolling = useCallback(() => {
    if (pollRef.current) return;
    setStatus("polling");
    const tick = async () => {
      if (pausedRef.current || outdatedRef.current) return;
      try {
        const res = await fetch("/api/analytics/server/snapshot", { cache: "no-store" });
        if (res.status === 404) {
          markOutdated();
          return;
        }
        if (!res.ok) throw new Error(`snapshot ${res.status}`);
        const data = (await res.json()) as ServerStats;
        errCountRef.current = 0;
        setStatus("polling");
        pushSample(data);
      } catch {
        if (!outdatedRef.current) setStatus("error");
      }
    };
    void tick();
    pollRef.current = setInterval(tick, INTERVAL_MS);
  }, [pushSample, markOutdated]);

  const connect = useCallback(() => {
    stopAll();
    outdatedRef.current = false;
    errCountRef.current = 0;
    if (pausedRef.current) {
      setStatus("paused");
      return;
    }
    setStatus("connecting");

    // Snapshot dulu untuk first paint cepat, SSE menyusul.
    // 404 = backend lama — hentikan semuanya, jangan retry buta.
    fetch("/api/analytics/server/snapshot", { cache: "no-store" })
      .then((r) => {
        if (r.status === 404) {
          markOutdated();
          return null;
        }
        if (!r.ok) throw new Error(`snapshot ${r.status}`);
        return r.json() as Promise<ServerStats>;
      })
      .then((data) => {
        if (!data || pausedRef.current || outdatedRef.current) return;
        pushSample(data);
      })
      .catch(() => {});

    const es = new EventSource(`/api/analytics/server/stream?interval_ms=${INTERVAL_MS}`);
    esRef.current = es;

    es.addEventListener("stats", (ev) => {
      if (pausedRef.current) return;
      try {
        const data = JSON.parse((ev as MessageEvent).data) as ServerStats;
        errCountRef.current = 0;
        setStatus("live");
        pushSample(data);
      } catch {
        // payload rusak — abaikan, tunggu tick berikutnya
      }
    });

    es.onerror = () => {
      errCountRef.current += 1;
      es.close();
      if (esRef.current === es) esRef.current = null;
      if (pausedRef.current || outdatedRef.current) return;
      if (errCountRef.current >= MAX_SSE_ERRORS_BEFORE_POLLING) {
        // SSE bermasalah berulang — fallback ke polling snapshot.
        startPolling();
        return;
      }
      setStatus("error");
      retryRef.current = setTimeout(() => {
        if (!pausedRef.current) connectRef.current();
      }, RECONNECT_DELAY_MS);
    };
  }, [pushSample, startPolling, stopAll, markOutdated]);

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  useEffect(() => {
    connectRef.current();
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);

  const togglePause = useCallback(() => {
    if (pausedRef.current) {
      setPaused(false);
      setGen((g) => g + 1);
    } else {
      setPaused(true);
      stopAll();
      setStatus("paused");
    }
  }, [stopAll]);

  const reconnect = useCallback(() => {
    errCountRef.current = 0;
    outdatedRef.current = false;
    if (pausedRef.current) setPaused(false);
    setGen((g) => g + 1);
  }, []);

  const meta = statusMeta(status);
  const cpuHist = history.map((h) => h.cpu_percent);
  const memHist = history.map((h) => h.mem_percent);
  const diskHist = history.map((h) => h.disk_percent);
  const loadHist = history.map((h) => h.load_1);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 py-6">
      {/* Header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="label-caps flex items-center gap-1.5">
            <Server className="h-3 w-3" />
            Phronesis Lab — Analytics Server
          </span>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Kondisi server <span className="text-faint">realtime.</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Push via Server-Sent Events tiap {INTERVAL_MS / 1000} detik.
            {latest
              ? ` Update terakhir ${formatTime(latest.timestamp)} · ${history.length} titik tersimpan.`
              : " Menghubungkan…"}
          </p>
          {latest?.degraded && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Sebagian metrik tidak tersedia di host ini (mode degraded).
            </p>
          )}
          {status === "outdated" && (
            <div className="flex max-w-md items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Backend belum mendukung analytics-server (HTTP 404) — binary{" "}
                <span className="font-mono">lab_backend</span> lama. Rebuild lalu{" "}
                <span className="font-mono">systemctl --user restart lab-backend.service</span>,
                kemudian tekan Reconnect.
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] font-medium text-ink">
            <span className="relative flex h-2 w-2">
              {meta.pulse && (
                <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", meta.dot)} />
              )}
              <span className={cn("relative inline-flex h-2 w-2 rounded-full", meta.dot)} />
            </span>
            {meta.label}
          </span>
          <button
            type="button"
            onClick={togglePause}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-medium text-ink transition-colors hover:bg-accent"
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            {paused ? "Resume" : "Pause"}
          </button>
          <button
            type="button"
            title="Reconnect"
            onClick={reconnect}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card text-muted transition-colors hover:bg-accent hover:text-ink"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </section>

      {/* Cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          icon={<Cpu className="h-4 w-4" />}
          title="CPU usage"
          big={latest ? `${latest.cpu_percent.toFixed(1)}%` : "—"}
          sub={latest ? `load ${latest.load_1.toFixed(2)} / ${latest.load_5.toFixed(2)} / ${latest.load_15.toFixed(2)}` : "menghubungkan…"}
          percent={latest?.cpu_percent ?? 0}
          values={cpuHist}
          sparkMax={100}
          accent="text-blue-600 dark:text-blue-400"
        />
        <StatCard
          icon={<MemoryStick className="h-4 w-4" />}
          title="Memory"
          big={latest ? `${latest.mem_percent.toFixed(1)}%` : "—"}
          sub={
            latest
              ? `${latest.mem_used_mb.toFixed(0)} / ${latest.mem_total_mb.toFixed(0)} MB`
              : "menghubungkan…"
          }
          percent={latest?.mem_percent ?? 0}
          values={memHist}
          sparkMax={100}
          accent="text-violet-600 dark:text-violet-400"
        />
        <StatCard
          icon={<HardDrive className="h-4 w-4" />}
          title="Disk /"
          big={latest ? `${latest.disk_percent.toFixed(1)}%` : "—"}
          sub={
            latest
              ? `${latest.disk_used_gb.toFixed(1)} / ${latest.disk_total_gb.toFixed(1)} GB`
              : "menghubungkan…"
          }
          percent={latest?.disk_percent ?? 0}
          values={diskHist}
          sparkMax={100}
          accent="text-amber-600 dark:text-amber-400"
        />
        <StatCard
          icon={<Gauge className="h-4 w-4" />}
          title="Load avg (1m)"
          big={latest ? latest.load_1.toFixed(2) : "—"}
          sub={
            latest
              ? `5m ${latest.load_5.toFixed(2)} · 15m ${latest.load_15.toFixed(2)}`
              : "menghubungkan…"
          }
          percent={latest ? Math.min(100, (latest.load_1 / 4) * 100) : 0}
          values={loadHist}
          sparkMax={4}
          accent="text-emerald-600 dark:text-emerald-400"
        />
      </section>

      {/* Strip bawah: uptime + proses */}
      <section className="grid grid-cols-1 divide-y divide-line rounded-lg border border-line bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          {
            icon: <Clock className="h-3.5 w-3.5" />,
            label: "Uptime",
            value: latest ? formatUptime(latest.uptime_sec) : "—",
            unit: latest ? `${latest.uptime_sec.toLocaleString("id-ID")} detik` : "menghubungkan",
          },
          {
            icon: <Activity className="h-3.5 w-3.5" />,
            label: "Goroutines backend",
            value: latest ? String(latest.goroutines) : "—",
            unit: "runtime go",
          },
          {
            icon: <Server className="h-3.5 w-3.5" />,
            label: "Transport",
            value: status === "live" ? "SSE" : status === "polling" ? "Polling" : status.toUpperCase(),
            unit: `tiap ${INTERVAL_MS / 1000} dtk`,
          },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-2 px-6 py-5">
            <span className="label-caps flex items-center gap-1.5">
              {s.icon}
              {s.label}
            </span>
            <div className="font-display text-2xl font-medium tracking-tight text-ink">
              {s.value}{" "}
              <span className="font-mono text-[11px] font-normal lowercase tracking-normal text-faint">
                {s.unit}
              </span>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
