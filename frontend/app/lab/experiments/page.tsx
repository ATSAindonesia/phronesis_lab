import React from "react";
import Link from "next/link";
import { Palette, ArrowRight } from "lucide-react";

export default function ExperimentsPage() {
  return (
    <div className="w-full max-w-lg">
      {/* Experiment card — b.ai hairline editorial */}
      <div className="group relative overflow-hidden rounded-xl border border-line bg-card p-8 transition-all duration-300 hover:border-line-strong hover:shadow-[0_24px_60px_-30px_rgba(20,20,19,0.3)]">
        {/* Card Header & Badges */}
        <div className="relative z-10 flex items-start justify-between gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-line bg-panel text-ink transition-colors duration-300 group-hover:bg-ink group-hover:text-gold">
            <Palette className="h-6 w-6" />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-gold-ink">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold" />
            Active
          </span>
        </div>

        {/* Content */}
        <div className="relative z-10 mt-6">
          <h2 className="font-display text-2xl font-medium tracking-tight text-ink">
            UI/UX Experiment
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Test and evaluate next-generation interface components with a
            design agent, a live Vite sandbox, and modern design systems built
            with Tailwind CSS.
          </p>

          {/* Tags */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            {["Design Tokens", "Components", "Interactive"].map((t) => (
              <span
                key={t}
                className="rounded border border-line bg-panel px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted"
              >
                {t}
              </span>
            ))}
          </div>
        </div>

        {/* Action Button */}
        <div className="relative z-10 mt-8">
          <Link
            href="/lab/experiments/ui-ux"
            className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-ink text-sm font-medium text-paper transition-all duration-200 hover:bg-black group-hover:gap-3 cursor-pointer"
          >
            <span>Open Playground</span>
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
