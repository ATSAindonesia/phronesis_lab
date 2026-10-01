"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

/* Palette: BONE #FDFBEF (bg) / TEAL #235451 (primary) / EMBER #EC5D3D (accent) */

const SPECIMENS = [
  {
    no: "01",
    code: "CHAT-01",
    title: "Unified Model API",
    body: "Single streaming endpoint for every upstream. Reasoning traces, model picker, conversation history.",
    meta: "/lab/chat — POST /v1/chat",
    href: "/lab/chat",
    cta: "Open",
  },
  {
    no: "02",
    code: "UIUX-02",
    title: "Sandbox Builder",
    body: "Design agent shipping React + Tailwind into a live Vite sandbox. Code, terminal, preview.",
    meta: "/lab/experiments/ui-ux — RUN",
    href: "/lab/experiments/ui-ux",
    cta: "Run",
  },
  {
    no: "03",
    code: "CONS-03",
    title: "Research Console",
    body: "Pipelines, tensors, benchmarks. Every run versioned, reproducible, attached to compute.",
    meta: "/lab/experiments — QUEUE",
    href: "/lab/experiments",
    cta: "Explore",
  },
];

const RUNS = [
  { id: "RUN-8412", model: "QWEN3-CODER", status: "RUNNING", progress: 72 },
  { id: "RUN-8411", model: "GLM-4.6", status: "QUEUED", progress: 8 },
  { id: "RUN-8410", model: "DEEPSEEK-V3", status: "DONE", progress: 100 },
  { id: "RUN-8409", model: "KIMI-K2", status: "DONE", progress: 100 },
];

const TICKER = [
  "EXP-8412 RUNNING",
  "QWEN3-CODER 72%",
  "GPU 28%",
  "F1 99.2",
  "NODES 4/4 ONLINE",
  "QUEUE 3",
  "LOG TAIL +1",
  "SPECIMENS 03",
];

const LOG_SEED = [
  "10:41:02 run-8412 checkpoint 72% — loss 0.184",
  "10:40:47 queue-8411 admitted — glm-4.6",
  "10:40:12 nodes 4/4 heartbeat ok — 12ms",
  "10:39:55 run-8410 eval done — f1 0.992",
  "10:39:31 sandbox uiux-02 mounted — vite ready",
];

function useNow() {
  const [now, setNow] = useState<Date | null>(
    () => (typeof window === "undefined" ? null : new Date())
  );
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function formatTime(d: Date | null) {
  if (!d) return "--:--:--";
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

function formatDate(d: Date | null) {
  if (!d) return "----.--.--";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}.${m}.${day}`;
}

export default function LabPage() {
  const now = useNow();
  const [gpu, setGpu] = useState(28);
  const [f1, setF1] = useState(99.2);
  const [models] = useState(4);
  const [log, setLog] = useState<string[]>(LOG_SEED);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (reduceMotion) return;
    const t = setInterval(() => {
      setGpu((g) => {
        const next = g + (Math.random() * 4 - 2);
        return Math.round(Math.min(92, Math.max(12, next)));
      });
      setF1((f) => {
        const next = f + (Math.random() * 0.2 - 0.1);
        return Math.round(Math.min(99.8, Math.max(98.4, next)) * 10) / 10;
      });
      setLog((prev) => {
        const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
        const events = [
          `run-8412 checkpoint — gpu ${Math.round(20 + Math.random() * 20)}%`,
          `nodes heartbeat ok — ${Math.round(8 + Math.random() * 14)}ms`,
          `queue depth ${1 + Math.round(Math.random() * 4)} — nominal`,
          `eval sample f1 ${(98 + Math.random() * 1.8).toFixed(2)}`,
        ];
        const line = `${ts} ${events[Math.floor(Math.random() * events.length)]}`;
        return [line, ...prev].slice(0, 9);
      });
    }, 2000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="w-full bg-[#FDFBEF] font-sans text-neutral-900 antialiased">
      {/* 00 — TOP INDEX STRIP */}
      <div className="grid grid-cols-2 border-b-2 border-[#235451] font-mono text-[10px] uppercase tracking-[0.18em] text-[#235451]/70 md:grid-cols-4">
        <div className="border-r border-[#235451]/30 px-4 py-2.5 md:px-6">
          Overview
        </div>
        <div className="px-4 py-2.5 md:border-r md:border-[#235451]/30 md:px-6">
          Lab—Phronesis
        </div>
        <div className="hidden border-r border-[#235451]/30 px-6 py-2.5 tabular-nums md:block">
          {formatDate(now)}
        </div>
        <div className="hidden items-center justify-end gap-2 px-6 py-2.5 text-[#235451] md:flex">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping bg-[#EC5D3D] opacity-40" />
            <span className="relative inline-flex h-2 w-2 bg-[#EC5D3D]" />
          </span>
          <span className="tabular-nums">Live — {formatTime(now)}</span>
        </div>
      </div>

      {/* TICKER — mono data tape */}
      <div className="swiss-ticker border-b-2 border-[#235451] bg-[#235451] py-2">
        <div className="swiss-ticker-track">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span
              key={`${t}-${i}`}
              className="mx-6 whitespace-nowrap font-mono text-[10px] uppercase tracking-[0.2em] text-[#FDFBEF]/85"
            >
              <span className="mr-6 inline-block h-1.5 w-1.5 bg-[#EC5D3D] align-middle" />
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* 01 — HERO GRID */}
      <section className="grid grid-cols-1 border-b-2 border-[#235451] md:grid-cols-12">
        <div className="flex flex-col justify-between gap-10 px-4 py-10 md:col-span-7 md:border-r-2 md:border-[#235451] md:px-10 md:py-14">
          <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#EC5D3D]">
            01 — Experiment Overview
          </div>
          <div>
            <h1 className="text-[13vw] font-bold leading-[0.86] tracking-[-0.04em] text-[#235451] sm:text-6xl md:text-7xl lg:text-[5.5rem]">
              EXPERIMENT
              <br />
              OVERVIEW
              <span className="align-top font-mono text-[0.35em] font-normal tracking-normal text-[#EC5D3D]">
                {" "}
                /R.01
              </span>
            </h1>
            <p className="mt-6 max-w-md text-sm leading-relaxed text-neutral-700">
              One pipeline for models, interfaces, and benchmarks. Select a
              specimen to open its endpoint. All runs are numbered, timed, and
              reproducible.
            </p>
            <div className="mt-8 flex flex-wrap gap-0">
              <Link
                href="/lab/chat"
                className="group inline-flex h-12 items-center gap-3 bg-[#235451] px-6 text-sm font-medium text-[#FDFBEF] transition-colors hover:bg-[#EC5D3D]"
              >
                Try the lab
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/lab/experiments"
                className="inline-flex h-12 items-center gap-2 border-2 border-[#235451] border-l-0 px-6 text-sm font-medium text-[#235451] transition-colors hover:bg-[#235451] hover:text-[#FDFBEF]"
              >
                New experiment
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-8 flex gap-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[#235451]/60">
              <span>Grid 12-col</span>
              <span>Sans / Mono</span>
              <span className="tabular-nums">Rev {formatDate(now)}</span>
            </div>
          </div>
        </div>

        {/* INSTRUMENT PANEL */}
        <div className="flex flex-col md:col-span-5">
          <div className="flex items-center justify-between border-t-2 border-[#235451] px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#235451]/70 md:border-t-0 md:px-8">
            <span>Instrument — Telemetry</span>
            <span className="flex items-center gap-2 text-[#235451]">
              <span className="h-1.5 w-1.5 animate-pulse bg-[#EC5D3D]" />
              Sampling
            </span>
          </div>
          <div className="grid flex-1 grid-cols-1 divide-y divide-[#235451]/25 border-t-2 border-[#235451]">
            {[
              {
                label: "Active models",
                value: String(models).padStart(2, "0"),
                unit: "/ 08 slots",
                bar: (models / 8) * 100,
              },
              {
                label: "GPU allocation",
                value: `${gpu}%`,
                unit: "cluster avg",
                bar: gpu,
              },
              {
                label: "Accuracy benchmark",
                value: `${f1.toFixed(1)}%`,
                unit: "f1 eval",
                bar: f1,
              },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-4 px-4 py-5 md:px-8"
              >
                <div>
                  <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#235451]/70">
                    {row.label}
                  </div>
                  <div className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-[#235451]">
                    {row.value}{" "}
                    <span className="font-mono text-[10px] font-normal uppercase tracking-[0.15em] text-[#235451]/50">
                      {row.unit}
                    </span>
                  </div>
                </div>
                <div className="w-24 shrink-0">
                  <div className="h-8 border border-[#235451]/40 bg-[#235451]/10 p-0.5">
                    <div
                      className="h-full bg-[#EC5D3D] transition-all duration-700"
                      style={{ width: `${Math.min(100, row.bar)}%` }}
                    />
                  </div>
                  <div className="mt-1 text-right font-mono text-[9px] tabular-nums text-[#235451]/50">
                    {Math.round(row.bar)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="border-t border-[#235451]/25 px-4 py-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#235451]/50 md:px-8">
            Fig. A — Load / Accuracy / Capacity
          </div>
        </div>
      </section>

      {/* 02 — SPECIMENS */}
      <section className="border-b-2 border-[#235451]">
        <div className="flex items-center justify-between px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#EC5D3D] md:px-10">
          <span>02 — Specimens / Endpoints</span>
          <span className="tabular-nums">03 units</span>
        </div>
        <div className="grid grid-cols-1 border-t-2 border-[#235451] md:grid-cols-3">
          {SPECIMENS.map((s) => (
            <Link
              key={s.code}
              href={s.href}
              className="group flex min-h-[280px] flex-col justify-between border-b border-[#235451]/25 bg-[#FDFBEF] p-6 transition-colors last:border-b-0 hover:bg-[#235451] hover:text-[#FDFBEF] md:border-b-0 md:border-r md:border-[#235451]/25 md:p-8 md:last:border-r-0"
            >
              <div>
                <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[#EC5D3D]">
                  <span>{s.no}</span>
                  <span>{s.code}</span>
                </div>
                <h3 className="mt-6 text-2xl font-bold tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-3 text-[13px] leading-relaxed text-neutral-700 group-hover:text-[#FDFBEF]/80">
                  {s.body}
                </p>
              </div>
              <div className="mt-8">
                <div className="font-mono text-[10px] uppercase tracking-[0.15em] text-[#235451]/50 group-hover:text-[#FDFBEF]/60">
                  {s.meta}
                </div>
                <div className="mt-3 flex items-center justify-between border-t border-[#235451]/25 pt-3 font-mono text-[11px] uppercase tracking-[0.2em] group-hover:border-[#FDFBEF]/25">
                  <span className="group-hover:text-[#EC5D3D]">{s.cta} →</span>
                  <ArrowUpRight className="h-4 w-4 text-[#EC5D3D] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 03 + 04 — RUN QUEUE / LOG */}
      <section className="grid grid-cols-1 md:grid-cols-12">
        <div className="md:col-span-7 md:border-r-2 md:border-[#235451]">
          <div className="flex items-center justify-between px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#EC5D3D] md:px-10">
            <span>03 — Run queue</span>
            <span className="tabular-nums">04 entries</span>
          </div>
          <div className="border-t-2 border-[#235451]">
            <div className="hidden grid-cols-12 gap-2 border-b border-[#235451]/30 bg-[#235451]/5 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.18em] text-[#235451]/60 md:grid md:px-10">
              <span className="col-span-3">ID</span>
              <span className="col-span-4">Model</span>
              <span className="col-span-2">Status</span>
              <span className="col-span-3 text-right">Progress</span>
            </div>
            {RUNS.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-2 gap-2 border-b border-[#235451]/20 px-4 py-3 font-mono text-xs last:border-b-0 hover:bg-[#235451]/5 md:grid-cols-12 md:items-center md:px-10"
              >
                <span className="font-bold tabular-nums text-[#235451] md:col-span-3">
                  {r.id}
                </span>
                <span className="text-right text-neutral-700 md:col-span-4 md:text-left">
                  {r.model}
                </span>
                <span className="flex items-center gap-2 text-[#235451] md:col-span-2">
                  <span
                    className={`inline-block h-1.5 w-1.5 ${
                      r.status === "RUNNING"
                        ? "animate-pulse bg-[#EC5D3D]"
                        : r.status === "QUEUED"
                          ? "bg-[#235451]/30"
                          : "bg-[#235451]"
                    }`}
                  />
                  {r.status}
                </span>
                <span className="flex items-center justify-end gap-2 tabular-nums text-[#235451] md:col-span-3">
                  <span className="hidden h-1.5 w-20 bg-[#235451]/15 sm:block">
                    <span
                      className="block h-full bg-[#235451]"
                      style={{ width: `${r.progress}%` }}
                    />
                  </span>
                  {r.progress}%
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col border-t-2 border-[#235451] md:col-span-5 md:border-t-0">
          <div className="flex items-center justify-between px-4 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-[#EC5D3D] md:px-8">
            <span>04 — Activity log</span>
            <span className="flex items-center gap-2 text-[#235451]">
              <span className="h-1.5 w-1.5 animate-pulse bg-[#EC5D3D]" />
              Tail
            </span>
          </div>
          <div className="min-h-[220px] flex-1 border-t-2 border-[#235451] bg-[#235451] p-4 font-mono text-[11px] leading-relaxed text-[#FDFBEF]/75 md:px-6">
            {log.map((line, i) => (
              <div
                key={`${line}-${i}`}
                className={`flex gap-3 border-b border-[#FDFBEF]/10 py-1.5 last:border-0 ${
                  i === 0 ? "text-[#FDFBEF]" : ""
                }`}
              >
                <span className="shrink-0 text-[#EC5D3D]">
                  {String(i).padStart(2, "0")}
                </span>
                <span className="tabular-nums">{line}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[#235451]/25 px-4 py-2.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[#235451]/50 md:px-8">
            Buffer 09 — auto-refresh 2s
          </div>
        </div>
      </section>

      {/* 05 — FOOTER STRIP */}
      <section className="grid grid-cols-1 items-center gap-4 border-t-2 border-[#235451] bg-[#FDFBEF] px-4 py-6 md:grid-cols-12 md:px-10">
        <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#EC5D3D] md:col-span-3">
          05 — Status
        </div>
        <div className="text-xl font-bold tracking-tight text-[#235451] md:col-span-6">
          ALL SYSTEMS NOMINAL —<br className="sm:hidden" /> NODES ONLINE.
        </div>
        <div className="md:col-span-3 md:text-right">
          <Link
            href="/lab/chat"
            className="inline-flex h-11 items-center gap-2 border-2 border-[#235451] px-5 text-sm font-medium text-[#235451] transition-colors hover:bg-[#235451] hover:text-[#FDFBEF]"
          >
            Enter Chat
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* BASELINE */}
      <div className="flex items-center justify-between border-t-2 border-[#235451] px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.2em] text-[#235451]/50 md:px-10">
        <span>Phronesis Lab — R.02 / Bone · Teal · Ember</span>
        <span className="tabular-nums">#FDFBEF #235451 #EC5D3D</span>
      </div>
    </div>
  );
}
