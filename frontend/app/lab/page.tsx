import React from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  MessageSquare,
  Boxes,
  Terminal,
} from "lucide-react";

const MODELS = [
  "Qwen 3 Coder",
  "GLM 4.6",
  "DeepSeek V3",
  "Kimi K2",
  "Llama 4",
  "GPT-5",
  "Claude Sonnet 4.5",
  "Gemini 2.5 Pro",
];

const FEATURES = [
  {
    icon: MessageSquare,
    title: "Unified Model API",
    body: "One streaming endpoint routes every upstream. Reasoning traces, model picker, and per-conversation history stored in the lab database.",
    href: "/lab/chat",
    cta: "Open Chat",
  },
  {
    icon: Boxes,
    title: "Sandbox Builder",
    body: "A design agent that ships React + Tailwind interfaces into a live Vite sandbox. Inspect code, terminal, and preview in one workspace.",
    href: "/lab/experiments/ui-ux",
    cta: "Run Experiment",
  },
  {
    icon: Terminal,
    title: "Research Console",
    body: "Pipelines, tensors, and benchmarks — interactively. Every run is versioned, reproducible, and connected to compute nodes.",
    href: "/lab/experiments",
    cta: "Explore",
  },
];

export default function LabPage() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 py-6">
      {/* Model marquee — b.ai ticker */}
      <div className="marquee rounded-lg border border-line bg-card py-2.5">
        <div className="marquee-track">
          {[...MODELS, ...MODELS].map((m, i) => (
            <span
              key={`${m}-${i}`}
              className="mx-5 flex items-center gap-2.5 whitespace-nowrap font-mono text-[11px] uppercase tracking-[0.14em] text-muted"
            >
              <span className="h-1 w-1 rounded-full bg-gold" />
              {m}
            </span>
          ))}
        </div>
      </div>

      {/* Hero — giant editorial display */}
      <section className="flex flex-col gap-6">
        <span className="label-caps">Phronesis Lab — Research Environment</span>
        <h1 className="hero-display text-5xl text-ink sm:text-6xl lg:text-7xl">
          Infrastructure
          <br />
          for thinking
          <br />
          <span className="text-faint">agents.</span>
        </h1>
        <p className="max-w-md text-sm leading-relaxed text-muted">
          Access global models through one borderless pipeline. Prototype
          interfaces with an agent, benchmark them in a sandbox, and ship what
          survives.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/lab/chat"
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-ink px-6 text-sm font-medium text-paper transition-all hover:bg-black active:scale-[0.98]"
          >
            Try the lab
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/lab/experiments"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-line-strong bg-card px-6 text-sm font-medium text-ink transition-all hover:bg-accent active:scale-[0.98]"
          >
            New experiment
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Stats strip — hairline separated, display numbers */}
      <section className="grid grid-cols-1 divide-y divide-line rounded-lg border border-line bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          { value: "4", unit: "instances", label: "Active Models" },
          { value: "28%", unit: "gpu allocation", label: "Compute Load" },
          { value: "99.2%", unit: "f1 score", label: "Accuracy Benchmark" },
        ].map((s) => (
          <div key={s.label} className="flex flex-col gap-2 px-6 py-5">
            <span className="label-caps">{s.label}</span>
            <div className="font-display text-3xl font-medium tracking-tight text-ink">
              {s.value}{" "}
              <span className="font-mono text-[11px] font-normal lowercase tracking-normal text-faint">
                {s.unit}
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* Feature cards — editorial 3-up, b.ai grid */}
      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <Link
              key={f.title}
              href={f.href}
              className="group hairline-card flex flex-col gap-4 p-6 transition-all hover:border-line-strong hover:shadow-[0_20px_50px_-30px_rgba(20,20,19,0.35)]"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-panel text-ink transition-colors group-hover:bg-ink group-hover:text-gold">
                <Icon className="h-[18px] w-[18px]" />
              </div>
              <div>
                <h3 className="font-display text-lg font-medium tracking-tight text-ink">
                  {f.title}
                </h3>
                <p className="mt-2 text-[13px] leading-relaxed text-muted">
                  {f.body}
                </p>
              </div>
              <span className="label-caps mt-auto flex items-center gap-1.5 text-gold-ink">
                {f.cta}
                <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          );
        })}
      </section>

      {/* Bottom black band — b.ai footer slab */}
      <section className="rounded-xl bg-night px-8 py-10 text-paper">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[#979797]">
              Status — all systems nominal
            </p>
            <h2 className="mt-3 font-display text-2xl font-medium tracking-tight sm:text-3xl">
              Authenticated. Nodes online.
              <br />
              <span className="text-[#979797]">Ready to research.</span>
            </h2>
          </div>
          <Link
            href="/lab/chat"
            className="inline-flex h-10 w-fit items-center gap-2 rounded-lg border border-white/20 px-5 text-sm font-medium text-paper transition-colors hover:border-gold hover:text-gold"
          >
            Enter Chat
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
