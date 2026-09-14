"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FlaskConical,
  Cpu,
  Database,
  LineChart,
  Terminal,
  Settings,
  FolderGit2,
  Hammer,
  ChevronRight,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string;
}

const navItems: NavItem[] = [
  { name: "Overview", href: "/lab", icon: FlaskConical },
  { name: "Experiments", href: "/lab/experiments", icon: FolderGit2, badge: "3 Running" },
  { name: "Builder", href: "/lab/builder", icon: Hammer },
  { name: "Models", href: "/lab/models", icon: Cpu },
  { name: "Datasets", href: "/lab/datasets", icon: Database },
  { name: "Analytics", href: "/lab/analytics", icon: LineChart },
  { name: "Console", href: "/lab/console", icon: Terminal },
  { name: "Settings", href: "/lab/settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [activeItem, setActiveItem] = useState("/lab");

  if (pathname === "/lab/experiments/ui-ux") {
    return null;
  }

  return (
    <aside className="relative flex h-screen w-64 flex-col border-r border-zinc-200/80 bg-white/90 dark:border-zinc-800/80 dark:bg-zinc-950/90 backdrop-blur-xl shrink-0 transition-all">
      {/* Brand Header */}
      <div className="flex h-16 items-center gap-3 border-b border-zinc-200/80 px-6 dark:border-zinc-800/80">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 shadow-md shadow-blue-500/20 text-white">
          <FlaskConical className="h-5 w-5" />
        </div>
        <div>
          <div className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            Lab Phronesis
          </div>
          <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
            Research & Intelligence
          </div>
        </div>
      </div>

      {/* Navigation List */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          Navigation
        </div>

        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || activeItem === item.href;

          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={() => setActiveItem(item.href)}
              className={cn(
                "group flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium transition-all duration-200",
                isActive
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400 font-semibold shadow-xs"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900/60 dark:hover:text-zinc-200"
              )}
            >
              <div className="flex items-center gap-3">
                <Icon
                  className={cn(
                    "h-4 w-4 transition-colors",
                    isActive
                      ? "text-blue-600 dark:text-blue-400"
                      : "text-zinc-400 group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                  )}
                />
                <span>{item.name}</span>
              </div>

              {item.badge ? (
                <span className="rounded-full bg-blue-100 dark:bg-blue-900/60 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-300">
                  {item.badge}
                </span>
              ) : isActive ? (
                <ChevronRight className="h-3.5 w-3.5 text-blue-500/60" />
              ) : null}
            </Link>
          );
        })}
      </div>

      {/* Sidebar Footer Info Card */}
      <div className="p-3 border-t border-zinc-200/80 dark:border-zinc-800/80">
        <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/60 p-3.5 dark:border-zinc-800/80 dark:bg-zinc-900/40">
          <div className="flex items-center gap-2 mb-2">
            <Zap className="h-4 w-4 text-amber-500" />
            <span className="text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              Compute Node
            </span>
          </div>
          <div className="space-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <div className="flex justify-between">
              <span>Environment:</span>
              <span className="font-mono text-zinc-700 dark:text-zinc-300">v1.4-prod</span>
            </div>
            <div className="flex justify-between">
              <span>Status:</span>
              <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                <ShieldCheck className="h-3 w-3" />
                Verified
              </span>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
