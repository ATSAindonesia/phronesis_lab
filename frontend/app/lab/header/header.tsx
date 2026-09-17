"use client";

import React from "react";
import { Search, Bell, Activity } from "lucide-react";
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
    <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-line bg-paper/85 pl-16 pr-4 backdrop-blur-md md:px-6">
      {/* Title & Status */}
      <div className="flex items-center gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="font-display text-[17px] font-medium tracking-tight text-ink">
              {title}
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-0.5 text-[11px] font-medium text-ink">
              <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" />
              Live
            </span>
          </div>
          <p className="label-caps hidden sm:block">{subtitle}</p>
        </div>
      </div>

      {/* Center Search / Command palette trigger */}
      <div className="hidden md:flex items-center">
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Search experiments, models, datasets... (⌘K)"
            className="h-9 w-72 rounded-lg border border-line bg-card pl-10 pr-4 text-xs text-ink placeholder:text-faint transition-all focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25 lg:w-96"
            readOnly
          />
        </div>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        {/* Activity Indicator */}
        <div className="hidden sm:flex items-center gap-2 rounded-lg border border-line px-2.5 py-1 text-xs text-muted">
          <Activity className="h-3.5 w-3.5 text-gold-ink" />
          <span>Cluster Online</span>
        </div>

        {/* Notifications */}
        <button
          type="button"
          className="relative hidden rounded-lg p-2 text-muted transition-colors hover:bg-accent sm:block"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-gold ring-2 ring-card" />
        </button>

        <div className="hidden h-4 w-px bg-line sm:block" />

        {/* User profile & Logout */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink font-display text-xs font-medium text-paper">
              S
            </div>
            <div className="hidden lg:block text-left">
              <div className="text-xs font-medium text-ink">Scientist</div>
              <div className="label-caps">Lab Member</div>
            </div>
          </div>
          <LogoutButton />
        </div>
      </div>
    </header>
  );
}
