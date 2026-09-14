"use client";

import React from "react";
import { Search, Bell, Sparkles, Activity } from "lucide-react";
import LogoutButton from "../logout-button";

export interface HeaderProps {
  title?: string;
  subtitle?: string;
}

export default function Header({
  title = "Research Lab",
  subtitle = "Phronesis Workspace",
}: HeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-zinc-200/80 bg-white/80 pl-16 pr-4 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/80 md:px-6">
      {/* Title & Status */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
              {title}
            </h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="hidden text-xs text-zinc-500 sm:block dark:text-zinc-400">{subtitle}</p>
        </div>
      </div>

      {/* Center Search / Command palette trigger */}
      <div className="hidden md:flex items-center">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3 h-4 w-4 text-zinc-400" />
          <input
            type="text"
            placeholder="Search experiments, models, datasets... (⌘K)"
            className="h-9 w-72 lg:w-96 rounded-full border border-zinc-200 bg-zinc-50/80 pl-9 pr-4 text-xs text-zinc-800 placeholder:text-zinc-400 focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:placeholder:text-zinc-500 dark:focus:bg-zinc-900 transition-all"
            readOnly
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Activity Indicator */}
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <Activity className="h-3.5 w-3.5 text-blue-500" />
          <span>Cluster Online</span>
        </div>

        {/* Notifications */}
        <button
          type="button"
          className="relative hidden rounded-full p-2 text-zinc-500 hover:bg-zinc-100 sm:block dark:text-zinc-400 dark:hover:bg-zinc-900 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-blue-500 ring-2 ring-white dark:ring-zinc-950" />
        </button>

        <div className="hidden h-4 w-px bg-zinc-200 sm:block dark:bg-zinc-800" />

        {/* User profile & Logout */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-tr from-blue-600 to-indigo-600 text-xs font-semibold text-white shadow-sm">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="hidden lg:block text-left">
              <div className="text-xs font-medium text-zinc-800 dark:text-zinc-200">
                Scientist
              </div>
              <div className="text-[10px] text-zinc-400">Lab Member</div>
            </div>
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
