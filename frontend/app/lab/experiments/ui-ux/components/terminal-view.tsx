"use client";

import React, { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal as TerminalIcon, Trash2 } from "lucide-react";

interface TerminalViewProps {
  onInput?: (input: string) => void;
  className?: string;
  initialLog?: string;
  title?: string;
}

export interface TerminalRef {
  write: (data: string) => void;
  writeln: (data: string) => void;
  clear: () => void;
}

const TerminalView = React.forwardRef<TerminalRef, TerminalViewProps>(
  ({ className, initialLog, title = "WebContainer Shell" }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const terminalRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 12,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        theme: {
          background: "#09090b",
          foreground: "#e4e4e7",
          cursor: "#f59e0b",
          black: "#18181b",
          red: "#fb7185",
          green: "#34d399",
          yellow: "#fbbf24",
          blue: "#a1a1aa",
          magenta: "#d6d3d1",
          cyan: "#f59e0b",
          white: "#f4f4f5",
          brightBlack: "#52525b",
          brightRed: "#fda4af",
          brightGreen: "#6ee7b7",
          brightYellow: "#fcd34d",
          brightBlue: "#d4d4d8",
          brightMagenta: "#e7e5e4",
          brightCyan: "#fbbf24",
          brightWhite: "#ffffff",
        },
        convertEol: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(containerRef.current);

      try {
        fitAddon.fit();
      } catch {
        // Container might not be visible immediately
      }

      terminalRef.current = term;
      fitAddonRef.current = fitAddon;

      term.writeln("\x1b[1;33m[agent] WebContainer shell initialized\x1b[0m");
      if (initialLog) {
        term.writeln(initialLog);
      }

      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
        } catch {
          // Ignore resize errors when container is detached
        }
      });

      resizeObserver.observe(containerRef.current);

      return () => {
        resizeObserver.disconnect();
        term.dispose();
      };
    }, [initialLog]);

    React.useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          terminalRef.current?.write(data);
        },
        writeln: (data: string) => {
          terminalRef.current?.writeln(data);
        },
        clear: () => {
          terminalRef.current?.clear();
        },
      }),
      []
    );

    const handleClear = () => {
      terminalRef.current?.clear();
    };

    return (
      <div className={`flex h-full w-full flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 ${className || ""}`}>
        {/* Terminal Header */}
        <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <TerminalIcon className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-mono">{title}</span>
          </div>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-300 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50"
            title="Clear Terminal"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear</span>
          </button>
        </div>
        {/* Terminal Canvas */}
        <div ref={containerRef} className="w-full flex-1 overflow-hidden p-2" />
      </div>
    );
  }
);

TerminalView.displayName = "TerminalView";

export default TerminalView;
