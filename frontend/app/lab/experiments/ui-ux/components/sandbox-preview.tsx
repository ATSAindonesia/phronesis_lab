"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  ExternalLink,
  Globe,
  Code2,
  Terminal,
  FileCode2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProjectFile {
  name: string;
  language: string;
  content: string;
}

export interface GeneratingStatus {
  step: "connecting" | "thinking" | "streaming" | "applying" | "ready";
  message: string;
  filePath?: string;
  linesCount?: number;
  elapsedSeconds?: number;
}

interface SandboxPreviewProps {
  files: Record<string, ProjectFile>;
  className?: string;
  keyTrigger?: string | number;
  onSwitchToFile?: (fileName: string) => void;
  isGenerating?: boolean;
  generatingStatus?: GeneratingStatus;
  previewUrl?: string | null;
  isBooting?: boolean;
  bootMessage?: string;
  liveLog?: string;
  onReload?: () => void;
  onSwitchToTerminal?: () => void;
  onSwitchToCode?: () => void;
}

export default function SandboxPreview({
  className,
  keyTrigger,
  isGenerating = false,
  generatingStatus,
  previewUrl = null,
  isBooting = false,
  bootMessage = "Starting dev server...",
  liveLog = "",
  onReload,
  onSwitchToTerminal,
  onSwitchToCode,
}: SandboxPreviewProps) {
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  // Reload iframe whenever external keyTrigger changes (e.g. file applied or generation complete)
  useEffect(() => {
    if (keyTrigger !== undefined && previewUrl) {
      setIframeKey((prev) => prev + 1);
    }
  }, [keyTrigger, previewUrl]);

  const handleManualReload = useCallback(() => {
    setIsRefreshing(true);
    setIframeKey((k) => k + 1);
    onReload?.();
    const timer = setTimeout(() => setIsRefreshing(false), 600);
    return () => clearTimeout(timer);
  }, [onReload]);

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden bg-card", className)}>
      {/* ─── Address Bar & Dev Controls ─── */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-line bg-panel px-3">
        <div className="flex min-w-0 flex-1 items-center">
          <div className="flex w-full max-w-md items-center gap-1.5 truncate rounded-md border border-line bg-card px-2 py-0.5 font-mono text-[11px] text-muted">
            <Globe className="h-3 w-3 shrink-0 text-faint" />
            <span className="truncate">
              {previewUrl ? previewUrl.replace(/^https?:\/\//, "") : "localhost:5173 (starting...)"}
            </span>
          </div>
        </div>

        <div className="ml-2 flex shrink-0 items-center gap-1">
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
              title="Open in new window"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            onClick={handleManualReload}
            disabled={isRefreshing}
            className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 cursor-pointer"
            title="Reload Preview"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-gold-ink")} />
          </button>
        </div>
      </div>

      {/* ─── Main Preview Surface ─── */}
      <div className="relative h-full w-full flex-1 overflow-hidden bg-card">
        {/* Booting / Dev Server Starting Indicator */}
        {(isBooting || !previewUrl) && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-panel p-6 text-center">
            <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-card text-muted">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-line-strong border-t-gold" />
            </div>
            <h4 className="text-sm font-medium text-ink">
              {bootMessage}
            </h4>
            <p className="mt-1.5 max-w-xs text-[11px] font-medium text-muted">
              Server sandbox (Docker + Vite) is preparing your live preview...
            </p>

            {/* Live Terminal Log Snippet */}
            {liveLog && (
              <div className="mt-4 w-full max-w-sm truncate rounded-md border border-line bg-card p-2.5 text-left font-mono text-[11px] text-muted">
                <span className="mr-1 text-gold-ink">$</span>
                <span className="truncate">{liveLog}</span>
              </div>
            )}

            {onSwitchToTerminal && (
              <button
                type="button"
                onClick={onSwitchToTerminal}
                className="mt-3 text-[11px] font-medium text-muted underline underline-offset-4 transition-colors hover:text-ink cursor-pointer"
              >
                View full terminal logs
              </button>
            )}
          </div>
        )}

        {/* Live Dev Server Iframe */}
        {previewUrl && (
          <iframe
            key={iframeKey}
            src={previewUrl}
            title="UI/UX Playground Preview"
            className="h-full w-full border-none bg-card"
            allow="cross-origin-isolated; autoplay; camera; microphone; geolocation"
          />
        )}
      </div>

      {/* ─── LIVE AGENT ACTIVITY OVERLAY ─── */}
      {isGenerating && (
        <div className="absolute bottom-3 left-3 right-3 z-30 w-full max-w-sm rounded-lg border border-line bg-card p-3 shadow-lg shadow-black/10 sm:left-auto">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-gold" />
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-medium text-ink">
                  {generatingStatus?.message || "Agent generating project changes..."}
                </span>
                <span className="flex min-w-0 items-center gap-1 truncate font-mono text-[11px] text-muted">
                  {generatingStatus?.filePath ? (
                    <>
                      <FileCode2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{generatingStatus.filePath}</span>
                      {generatingStatus.linesCount !== undefined && (
                        <span className="shrink-0 text-faint">({generatingStatus.linesCount} lines)</span>
                      )}
                    </>
                  ) : (
                    <span>SSE stream active</span>
                  )}
                </span>
              </div>
            </div>

            {/* Quick Action Switches */}
            <div className="flex shrink-0 items-center gap-1">
              {onSwitchToCode && (
                <button
                  type="button"
                  onClick={onSwitchToCode}
                  className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 cursor-pointer"
                  title="View live code being streamed"
                >
                  <Code2 className="h-3 w-3" />
                  <span>Code</span>
                </button>
              )}
              {onSwitchToTerminal && (
                <button
                  type="button"
                  onClick={onSwitchToTerminal}
                  className="flex items-center gap-1 rounded-md border border-line bg-panel px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 cursor-pointer"
                  title="View terminal logs"
                >
                  <Terminal className="h-3 w-3" />
                  <span>Logs</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
