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
          foreground: "#f4f4f5",
          cursor: "#38bdf8",
          black: "#18181b",
          red: "#f43f5e",
          green: "#10b981",
          yellow: "#f59e0b",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#f4f4f5",
          brightBlack: "#52525b",
          brightRed: "#fb7185",
          brightGreen: "#34d399",
          brightYellow: "#fbbf24",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
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

      term.writeln("\x1b[1;34m⚡ WebContainer Shell Initialized\x1b[0m");
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
      <div className={`flex flex-col h-full w-full bg-zinc-950 border border-zinc-800/80 rounded-xl overflow-hidden shadow-inner ${className || ""}`}>
        {/* Terminal Header */}
        <div className="flex h-9 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-3 shrink-0">
          <div className="flex items-center gap-2 text-xs font-medium text-zinc-300">
            <TerminalIcon className="h-3.5 w-3.5 text-blue-400" />
            <span>{title}</span>
          </div>
          <button
            onClick={handleClear}
            className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800"
            title="Clear Terminal"
          >
            <Trash2 className="h-3 w-3" />
            <span>Clear</span>
          </button>
        </div>
        {/* Terminal Canvas */}
        <div ref={containerRef} className="flex-1 w-full overflow-hidden p-2" />
      </div>
    );
  }
);

TerminalView.displayName = "TerminalView";

export default TerminalView;
