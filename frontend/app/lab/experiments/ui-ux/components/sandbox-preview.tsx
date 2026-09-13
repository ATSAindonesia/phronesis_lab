"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  AlertCircle,
  RefreshCw,
  Sparkles,
  ExternalLink,
  Cpu,
  Globe,
  Code2,
  Terminal,
  FileCode2,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { checkCrossOriginIsolation } from "../lib/webcontainer";

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
  const [isIsolated, setIsIsolated] = useState<boolean>(true);

  useEffect(() => {
    setIsIsolated(checkCrossOriginIsolation());
  }, []);

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
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden bg-zinc-950", className)}>
      {/* ─── Address Bar & Dev Controls ─── */}
      <div className="flex h-10 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/70 px-3.5 backdrop-blur-md shrink-0 z-10">
        <div className="flex items-center gap-2 flex-1 max-w-md">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800/80 text-[11px] text-zinc-400 font-mono w-full truncate">
            <Globe className="h-3 w-3 text-emerald-400 shrink-0" />
            <span className="truncate">
              {previewUrl ? previewUrl.replace(/^https?:\/\//, "") : "localhost:5173 (starting...)"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 ml-2">
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
              title="Open in new window"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          <button
            onClick={handleManualReload}
            disabled={isRefreshing}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
            title="Reload Preview"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin text-blue-400")} />
          </button>
        </div>
      </div>

      {/* ─── Main Preview Surface ─── */}
      <div className="relative flex-1 w-full h-full overflow-hidden bg-zinc-950">
        {/* Cross-Origin Isolation Warning if headers blocked */}
        {!isIsolated && (
          <div className="absolute inset-0 z-30 flex items-center justify-center p-6 bg-zinc-950/95 backdrop-blur-sm">
            <div className="max-w-md w-full rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-zinc-200 shadow-2xl">
              <div className="flex items-center gap-3 mb-3">
                <AlertCircle className="h-6 w-6 text-amber-400 shrink-0" />
                <h3 className="text-sm font-bold text-amber-300">Cross-Origin Isolation Required</h3>
              </div>
              <p className="text-xs text-zinc-300 leading-relaxed">
                WebContainers require <code className="px-1.5 py-0.5 rounded bg-zinc-900 font-mono text-amber-300">Cross-Origin-Opener-Policy: same-origin</code> and <code className="px-1.5 py-0.5 rounded bg-zinc-900 font-mono text-amber-300">Cross-Origin-Embedder-Policy</code> headers to run Node.js in your browser.
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => window.location.reload()}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 text-zinc-950 text-xs font-semibold hover:bg-amber-400 transition"
                >
                  Hard Refresh Page
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Booting / Dev Server Starting Indicator */}
        {(isBooting || !previewUrl) && isIsolated && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-zinc-950 text-center p-6">
            <div className="relative flex items-center justify-center mb-4">
              <div className="h-12 w-12 rounded-2xl border border-blue-500/30 bg-blue-500/10 flex items-center justify-center text-blue-400 animate-pulse">
                <Cpu className="h-6 w-6" />
              </div>
            </div>
            <h4 className="text-sm font-semibold text-zinc-200">
              {bootMessage}
            </h4>
            <p className="mt-1.5 text-xs text-zinc-500 max-w-xs">
              Initializing WebContainer virtual filesystem and launching Vite development server...
            </p>

            {/* Live Terminal Log Snippet */}
            {liveLog && (
              <div className="mt-4 max-w-sm w-full rounded-xl border border-zinc-800 bg-zinc-900/80 p-2.5 text-left font-mono text-[11px] text-zinc-400 shadow-inner overflow-hidden truncate">
                <span className="text-blue-400 mr-1">$</span>
                <span className="truncate">{liveLog}</span>
              </div>
            )}

            {onSwitchToTerminal && (
              <button
                type="button"
                onClick={onSwitchToTerminal}
                className="mt-3 text-[11px] text-zinc-500 hover:text-zinc-300 underline underline-offset-4 cursor-pointer"
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
            className="h-full w-full border-none bg-white"
            allow="cross-origin-isolated; autoplay; camera; microphone; geolocation"
          />
        )}
      </div>

      {/* ─── LIVE AGENT ACTIVITY OVERLAY (Bolt-style visual feedback) ─── */}
      {isGenerating && (
        <div className="absolute bottom-4 left-4 right-4 sm:left-auto sm:right-4 z-30 max-w-md w-full rounded-2xl border border-blue-500/30 bg-zinc-900/95 p-3.5 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-500/15 border border-blue-500/30 text-blue-400 shrink-0">
                <Sparkles className="h-4 w-4 animate-spin" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-semibold text-zinc-100 truncate">
                  {generatingStatus?.message || "Agent generating project changes..."}
                </span>
                <span className="text-[10px] text-zinc-400 flex items-center gap-1 font-mono truncate">
                  {generatingStatus?.filePath ? (
                    <>
                      <FileCode2 className="h-3 w-3 text-blue-400 shrink-0" />
                      <span>{generatingStatus.filePath}</span>
                      {generatingStatus.linesCount !== undefined && (
                        <span className="text-zinc-500">({generatingStatus.linesCount} lines)</span>
                      )}
                    </>
                  ) : (
                    <span>Real-time SSE WebContainer Stream</span>
                  )}
                </span>
              </div>
            </div>

            {/* Quick Action Switches */}
            <div className="flex items-center gap-1 shrink-0">
              {onSwitchToCode && (
                <button
                  type="button"
                  onClick={onSwitchToCode}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition cursor-pointer"
                  title="View live code being streamed"
                >
                  <Code2 className="h-3 w-3 text-blue-400" />
                  <span>Code</span>
                </button>
              )}
              {onSwitchToTerminal && (
                <button
                  type="button"
                  onClick={onSwitchToTerminal}
                  className="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[10px] font-medium text-zinc-300 hover:bg-zinc-700 hover:text-white transition cursor-pointer"
                  title="View terminal logs"
                >
                  <Terminal className="h-3 w-3 text-emerald-400" />
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
