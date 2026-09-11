import React from "react";
import {
  FlaskConical,
  Sparkles,
  ArrowUpRight,
  Cpu,
  Layers,
  CheckCircle2,
  Terminal,
} from "lucide-react";

export default function LabPage() {
  return (
    <div className="w-full max-w-3xl rounded-3xl border border-zinc-200/80 bg-white/80 p-8 shadow-xl shadow-zinc-950/5 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-900/80 dark:shadow-black/40 transition-all">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-100 pb-6 dark:border-zinc-800">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25">
            <FlaskConical className="h-7 w-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                Phronesis Lab Hub
              </h2>
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2.5 py-0.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
                <Sparkles className="h-3 w-3" />
                Active Node
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Welcome to the central research environment. All experimental pipelines are ready.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="flex items-center gap-1.5 rounded-xl bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Authenticated
          </span>
        </div>
      </div>

      {/* Metric Cards Grid */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/40">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Active Models</span>
            <Cpu className="h-4 w-4 text-blue-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            4 <span className="text-xs font-normal text-zinc-400">instances</span>
          </div>
          <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            +1 loaded recently
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/40">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Compute Load</span>
            <Layers className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            28% <span className="text-xs font-normal text-zinc-400">GPU allocation</span>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Optimal temperature
          </p>
        </div>

        <div className="rounded-2xl border border-zinc-100 bg-zinc-50/70 p-4 dark:border-zinc-800/60 dark:bg-zinc-950/40">
          <div className="flex items-center justify-between text-zinc-400">
            <span className="text-xs font-medium">Accuracy Benchmark</span>
            <Sparkles className="h-4 w-4 text-violet-500" />
          </div>
          <div className="mt-2 text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            99.2% <span className="text-xs font-normal text-zinc-400">F1 score</span>
          </div>
          <p className="mt-1 text-[11px] text-emerald-600 dark:text-emerald-400">
            Top tier performance
          </p>
        </div>
      </div>

      {/* Action shortcuts */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-500/20 bg-blue-500/5 p-4 dark:border-blue-500/10 dark:bg-blue-950/20">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500 text-white">
            <Terminal className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Interactive Experimentation Console
            </div>
            <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Run inference tests and inspect tensors directly in real-time.
            </div>
          </div>
        </div>

        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 text-xs font-semibold text-white shadow-sm shadow-blue-600/30 transition-all hover:bg-blue-700 active:scale-95 cursor-pointer"
        >
          <span>New Run</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
