import React from "react";
import Link from "next/link";
import {
  Palette,
  Sparkles,
  ArrowRight,
  Layers,
  LayoutGrid,
  Zap,
} from "lucide-react";

export default function ExperimentsPage() {
  return (
    <div className="w-full max-w-lg">
      {/* 1 Button Card: UI/UX Experiment */}
      <div className="group relative overflow-hidden rounded-3xl border border-zinc-200/90 bg-white/90 p-8 shadow-xl shadow-zinc-950/5 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-blue-500/50 hover:shadow-2xl hover:shadow-blue-500/10 dark:border-zinc-800/90 dark:bg-zinc-900/90 dark:shadow-black/40 dark:hover:border-blue-500/40">
        {/* Glow Accent Effect */}
        <div
          className="pointer-events-none absolute -top-20 -right-20 h-40 w-40 rounded-full bg-gradient-to-br from-blue-500/20 via-indigo-500/15 to-purple-500/10 blur-3xl transition-opacity duration-300 group-hover:opacity-100 opacity-60"
          aria-hidden="true"
        />

        {/* Card Header & Badges */}
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 text-white shadow-lg shadow-blue-500/25 transition-transform duration-300 group-hover:scale-105">
            <Palette className="h-7 w-7" />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold text-blue-600 dark:text-blue-400">
            <Sparkles className="h-3.5 w-3.5 animate-pulse" />
            Active Experiment
          </span>
        </div>

        {/* Content */}
        <div className="relative z-10 mt-6">
          <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            UI/UX Experiment
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Test and evaluate next-generation interface components, dynamic glassmorphic interactions, and modern design systems built with Tailwind CSS.
          </p>

          {/* Tags */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
              <Layers className="h-3 w-3 text-blue-500" />
              Design Tokens
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
              <LayoutGrid className="h-3 w-3 text-indigo-500" />
              Components
            </span>
            <span className="inline-flex items-center gap-1 rounded-lg border border-zinc-200/80 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-400">
              <Zap className="h-3 w-3 text-amber-500" />
              Interactive
            </span>
          </div>
        </div>

        {/* Action Button */}
        <div className="relative z-10 mt-8">
          <Link
            href="/lab/experiments/ui-ux"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 font-semibold text-sm text-white shadow-lg shadow-blue-500/25 transition-all duration-200 hover:from-blue-700 hover:via-indigo-700 hover:to-violet-700 hover:shadow-blue-500/35 active:scale-[0.98] cursor-pointer"
          >
            <span>UI/UX Experiment</span>
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
