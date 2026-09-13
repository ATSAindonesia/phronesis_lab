"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Eye,
  Code2,
  Monitor,
  Tablet,
  Smartphone,
  Copy,
  Check,
  FileCode2,
  RotateCcw,
  Send,
  FolderTree,
  AlertCircle,
  X,
  Bot,
  Terminal as TerminalIcon,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SandboxPreview, { ProjectFile, GeneratingStatus } from "./components/sandbox-preview";
import TerminalView, { TerminalRef } from "./components/terminal-view";
import LogoutButton from "../../logout-button";
import {
  getWebContainer,
  writeContainerFile,
  spawnCommand,
  checkCrossOriginIsolation,
  starterFiles,
} from "./lib/webcontainer";
import {
  StreamingActionParser,
  BoltAction,
} from "./lib/action-parser";

const initialDefaultFiles: Record<string, ProjectFile> = {
  "src/App.tsx": {
    name: "src/App.tsx",
    language: "typescript",
    content: (starterFiles.src as { directory: Record<string, { file: { contents: string } }> })
      .directory["App.tsx"].file.contents,
  },
  "src/main.tsx": {
    name: "src/main.tsx",
    language: "typescript",
    content: (starterFiles.src as { directory: Record<string, { file: { contents: string } }> })
      .directory["main.tsx"].file.contents,
  },
  "src/styles.css": {
    name: "src/styles.css",
    language: "css",
    content: (starterFiles.src as { directory: Record<string, { file: { contents: string } }> })
      .directory["styles.css"].file.contents,
  },
  "index.html": {
    name: "index.html",
    language: "html",
    content: (starterFiles["index.html"] as { file: { contents: string } }).file.contents,
  },
  "package.json": {
    name: "package.json",
    language: "json",
    content: (starterFiles["package.json"] as { file: { contents: string } }).file.contents,
  },
  "tailwind.config.js": {
    name: "tailwind.config.js",
    language: "javascript",
    content: (starterFiles["tailwind.config.js"] as { file: { contents: string } }).file.contents,
  },
  "vite.config.js": {
    name: "vite.config.js",
    language: "javascript",
    content: (starterFiles["vite.config.js"] as { file: { contents: string } }).file.contents,
  },
};

const promptSuggestions = [
  "Create an authentic Italian restaurant landing page with a menu and table reservation form",
  "Create a developer portfolio with interactive project cards, skills grid, and contact modal",
  "Create a sleek fintech dashboard with net worth charts, asset breakdown, and transfer widget",
  "Add dark glassmorphism styling and smooth interactive hover effects",
];

export default function UiUxPlaygroundPage() {
  // 1. Files & Active Document State
  const [files, setFiles] = useState<Record<string, ProjectFile>>(initialDefaultFiles);
  const [activeFileName, setActiveFileName] = useState<string>("src/App.tsx");
  const [currentPromptTitle, setCurrentPromptTitle] = useState<string>("Bolt Playground Ready");

  // 2. Prompt & Generating State
  const [prompt, setPrompt] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // 3. View Controls
  const [viewMode, setViewMode] = useState<"preview" | "code" | "activity">("preview");
  const [activitySubTab, setActivitySubTab] = useState<"terminal" | "actions">("terminal");
  const [viewportSize, setViewportSize] = useState<"desktop" | "tablet" | "mobile">("desktop");

  // 4. WebContainer & Dev Server State
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState<boolean>(true);
  const [bootMessage, setBootMessage] = useState<string>("Initializing WebContainer runtime...");
  const [liveLog, setLiveLog] = useState<string>("");

  // 5. Agent Telemetry State
  const [agentThought, setAgentThought] = useState<string | null>(null);
  const [agentActions, setAgentActions] = useState<BoltAction[]>([]);
  const [recentModifiedFiles, setRecentModifiedFiles] = useState<string[]>([]);
  const [expandedActionIndex, setExpandedActionIndex] = useState<number | null>(null);
  const [generatingStatus, setGeneratingStatus] = useState<GeneratingStatus>({
    step: "ready",
    message: "",
  });
  const [previewRefreshKey, setPreviewRefreshKey] = useState<number>(0);

  // 6. Refs
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<TerminalRef | null>(null);

  // Boot WebContainer, install dependencies, and launch Vite dev server
  useEffect(() => {
    let isMounted = true;

    async function initWebContainer() {
      if (!checkCrossOriginIsolation()) {
        setIsBooting(false);
        setBootMessage("Cross-Origin Isolation required for WebContainer.");
        return;
      }

      try {
        setBootMessage("Booting in-browser WebContainer (Node.js/Wasm)...");
        terminalRef.current?.writeln("\x1b[1;34m[fs] Booting WebContainer virtual micro-OS...\x1b[0m");

        const container = await getWebContainer();
        if (!isMounted) return;

        terminalRef.current?.writeln("\x1b[1;32m[fs] Virtual filesystem mounted.\x1b[0m");

        // 1. Listen for internal dev server port ready BEFORE spawning commands
        container.on("server-ready", (port, url) => {
          if (!isMounted) return;
          terminalRef.current?.writeln(`\x1b[1;32m[vite] Dev server ready at ${url} (port ${port})\x1b[0m`);
          setPreviewUrl(url);
          setIsBooting(false);
        });

        // 2. Install project dependencies first so node_modules exists
        setBootMessage("Installing project dependencies (npm install)...");
        terminalRef.current?.writeln("\x1b[1;33m[npm] Installing packages: react, react-dom, vite...\x1b[0m");

        const installExitCode = await spawnCommand(
          "npm",
          ["install", "--no-audit", "--no-fund", "--prefer-offline"],
          (chunk) => {
            terminalRef.current?.write(chunk);
            const line = chunk.trim();
            if (line) setLiveLog(line);
          }
        );

        if (!isMounted) return;

        if (installExitCode !== 0) {
          terminalRef.current?.writeln(`\x1b[1;31m[err] npm install exited with code ${installExitCode}\x1b[0m`);
          setBootMessage(`npm install failed (exit code ${installExitCode}). Check terminal logs.`);
          setIsBooting(false);
          return;
        }

        terminalRef.current?.writeln("\x1b[1;32m[npm] Dependencies installed successfully.\x1b[0m");

        // 3. Launch Vite dev server directly via npm run dev
        setBootMessage("Starting Vite development server...");
        terminalRef.current?.writeln("\x1b[1;36m[vite] Starting dev server (npm run dev)...\x1b[0m");

        const devExitCode = await spawnCommand(
          "npm",
          ["run", "dev", "--", "--host"],
          (chunk) => {
            terminalRef.current?.write(chunk);
            const line = chunk.trim();
            if (line) setLiveLog(line);
          }
        );

        if (!isMounted) return;

        if (devExitCode !== 0) {
          terminalRef.current?.writeln(`\x1b[1;31m[err] Dev server exited with code ${devExitCode}\x1b[0m`);
          setBootMessage(`Vite dev server exited with code ${devExitCode}. Check terminal.`);
          setIsBooting(false);
        }

      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setBootMessage(`WebContainer boot failed: ${msg}`);
        terminalRef.current?.writeln(`\x1b[1;31m[err] Boot failed: ${msg}\x1b[0m`);
        setIsBooting(false);
      }
    }

    initWebContainer();

    return () => {
      isMounted = false;
    };
  }, []);

  const activeFile = files[activeFileName] || Object.values(files)[0];
  const contentLines = (activeFile?.content || "").split("\n");

  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Connected Streaming AI Generation Handler (Bolt-style SSE stream)
  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    if (isBooting || !previewUrl) {
      terminalRef.current?.writeln("\x1b[1;33m[agent] WebContainer is initializing. Ready in a few seconds...\x1b[0m");
    }

    const userPrompt = prompt.trim();
    setIsGenerating(true);
    setErrorMessage(null);
    setCurrentPromptTitle(userPrompt);
    setPrompt("");
    setGeneratingStatus({
      step: "connecting",
      message: "Connecting to autonomous coding agent...",
    });

    terminalRef.current?.writeln(`\r\n\x1b[1;33m[agent] Prompt: "${userPrompt}"\x1b[0m`);

    const parser = new StreamingActionParser({
      onArtifactStart: ({ title }) => {
        terminalRef.current?.writeln(`\x1b[1;34m[agent] Building artifact: ${title}\x1b[0m`);
        setGeneratingStatus({
          step: "streaming",
          message: `Building Artifact: ${title}`,
        });
      },
      onActionStart: (action) => {
        if (action.type === "file" && action.filePath) {
          const path = action.filePath;
          terminalRef.current?.writeln(`\x1b[1;36m[fs] Streaming file: ${path}...\x1b[0m`);

          setFiles((prev) => ({
            ...prev,
            [path]: {
              name: path,
              language: path.endsWith(".css") ? "css" : "typescript",
              content: "",
            },
          }));
          setActiveFileName(path);
          setRecentModifiedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
          setGeneratingStatus({
            step: "streaming",
            message: `Writing ${path}...`,
            filePath: path,
            linesCount: 1,
          });
        } else if (action.type === "shell") {
          terminalRef.current?.writeln(`\x1b[1;33m[shell] Preparing command: ${action.content || "..."}\x1b[0m`);
          setGeneratingStatus({
            step: "streaming",
            message: `Shell: ${action.content || "preparing..."}`,
          });
        }

        setAgentActions((prev) => [...prev, action]);
      },
      onActionStream: (action, delta) => {
        if (action.type === "file" && action.filePath) {
          const path = action.filePath;
          setFiles((prev) => {
            const existing = prev[path];
            return {
              ...prev,
              [path]: {
                name: path,
                language: path.endsWith(".css") ? "css" : "typescript",
                content: (existing?.content || "") + delta,
              },
            };
          });
          const count = (action.content.match(/\n/g) || []).length + 1;
          setGeneratingStatus((prev) => ({
            ...prev,
            linesCount: count,
          }));
        }
      },
      onActionComplete: async (action) => {
        if (action.type === "file" && action.filePath) {
          const path = action.filePath;
          setGeneratingStatus({
            step: "applying",
            message: `Applying ${path} to WebContainer...`,
            filePath: path,
          });
          // Update React files state with the finalized clean code
          setFiles((prev) => ({
            ...prev,
            [path]: {
              name: path,
              language: path.endsWith(".css") ? "css" : "typescript",
              content: action.content,
            },
          }));
          try {
            await writeContainerFile(path, action.content);
            terminalRef.current?.writeln(`\x1b[1;32m[ok] Applied ${path} to WebContainer (HMR updated)\x1b[0m`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            terminalRef.current?.writeln(`\x1b[1;31m[err] Failed writing ${path}: ${msg}\x1b[0m`);
          }
        } else if (action.type === "shell") {
          const commandLine = action.content.trim();
          if (commandLine) {
            terminalRef.current?.writeln(`\x1b[1;33m$ ${commandLine}\x1b[0m`);
            const parts = commandLine.split(" ").filter(Boolean);
            const cmd = parts[0];
            const args = parts.slice(1);
            try {
              await spawnCommand(cmd, args, (chunk) => {
                terminalRef.current?.write(chunk);
              });
              terminalRef.current?.writeln(`\x1b[1;32m[ok] Command completed: ${commandLine}\x1b[0m`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              terminalRef.current?.writeln(`\x1b[1;31m[err] Command failed: ${msg}\x1b[0m`);
            }
          }
        }

        setAgentActions((prev) =>
          prev.map((a) => (a.id === action.id ? { ...a, status: "complete", content: action.content } : a))
        );
      },
      onThought: (thought) => {
        setAgentThought(thought);
      },
      onArtifactComplete: () => {
        terminalRef.current?.writeln(`\x1b[1;32m[ok] Artifact finished successfully.\x1b[0m`);
      },
    });

    try {
      const res = await fetch("/api/experiments/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          prompt: userPrompt,
          files,
          stream: true,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        throw new Error(errText || `Server responded with status ${res.status}`);
      }

      if (!res.body) {
        throw new Error("Streaming body not available in response.");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        const lines = streamBuffer.split("\n");
        streamBuffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("data:")) {
            const dataContent = trimmed.slice(5).trim();
            if (dataContent === "[DONE]" || !dataContent) continue;

            try {
              const parsed = JSON.parse(dataContent);
              if (parsed.text) {
                parser.feed(parsed.text);
              }
              if (parsed.thought) {
                setAgentThought((prev) => (prev ? prev + parsed.thought : parsed.thought));
              }
              if (parsed.phase === "generating") {
                setGeneratingStatus({
                  step: "thinking",
                  message: "Agent synthesizing UI components & architecture...",
                });
              }
              if (parsed.status === "alive") {
                if (parsed.elapsed) {
                  setGeneratingStatus((prev) => ({
                    ...prev,
                    step: "thinking",
                    elapsedSeconds: parsed.elapsed,
                    message: `Agent reasoning & designing architecture (${parsed.elapsed}s)...`,
                  }));
                }
                continue;
              }
              if (parsed.error) {
                setErrorMessage(parsed.error);
                terminalRef.current?.writeln(`\x1b[1;31m[err] Agent error: ${parsed.error}\x1b[0m`);
              }
            } catch {
              // Raw text chunk
              parser.feed(dataContent);
            }
          }
        }
      }

      parser.finish();
      setGeneratingStatus({
        step: "ready",
        message: "Application updated successfully!",
      });
      setPreviewRefreshKey((k) => k + 1);
      terminalRef.current?.writeln(`\x1b[1;32m[ok] Agent generation complete.\x1b[0m\r\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      terminalRef.current?.writeln(`\x1b[1;31m[err] ${msg}\x1b[0m`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyCode = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleReset = async () => {
    setFiles(initialDefaultFiles);
    setActiveFileName("src/App.tsx");
    setCurrentPromptTitle("Bolt Playground Ready");
    setPrompt("");
    setErrorMessage(null);
    setAgentThought(null);
    setAgentActions([]);
    setRecentModifiedFiles([]);

    // Reset files in WebContainer
    try {
      await writeContainerFile(
        "src/App.tsx",
        (starterFiles.src as { directory: Record<string, { file: { contents: string } }> })
          .directory["App.tsx"].file.contents
      );
      terminalRef.current?.writeln("\x1b[1;33m[fs] Workspace reset to starter template.\x1b[0m");
    } catch {
      // Ignore
    }
  };

  const handleSwitchToFile = (fileName: string) => {
    if (files[fileName]) {
      setActiveFileName(fileName);
      setViewMode("code");
    }
  };

  const getFileBadge = (fileName: string) => {
    if (fileName.endsWith(".tsx") || fileName.endsWith(".jsx")) {
      return { label: "TSX", color: "text-stone-600 border-stone-300 dark:text-zinc-400 dark:border-zinc-700" };
    }
    if (fileName.endsWith(".css")) {
      return { label: "CSS", color: "text-emerald-600 border-emerald-600/40 dark:text-emerald-400 dark:border-emerald-400/40" };
    }
    return { label: "TS", color: "text-amber-600 border-amber-600/40 dark:text-amber-400 dark:border-amber-400/40" };
  };

  return (
    <div className="flex h-dvh w-full flex-col overflow-hidden bg-stone-100 font-sans dark:bg-zinc-950 lg:flex-row">

      {/* ─── LEFT: AGENT SIDEPANEL ─── */}
      <aside className="flex w-full shrink-0 flex-col border-b border-stone-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
        {/* Header */}
        <div className="flex h-12 shrink-0 items-center gap-2.5 border-b border-stone-200 px-4 dark:border-zinc-800">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-amber-600/30 bg-amber-500/10 text-amber-600 dark:border-amber-400/30 dark:text-amber-400">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-medium text-stone-900 dark:text-zinc-50">
              Agent Control
            </div>
            <div className="text-[11px] font-medium text-stone-500 dark:text-zinc-400">
              Coding agent workspace
            </div>
          </div>
        </div>

        {/* Main Content Area (Suggestions, History, etc.) */}
        <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-4">
          {isGenerating ? (
            <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-950">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-amber-600 dark:bg-amber-400" />
                <span className="text-sm font-medium text-stone-900 dark:text-zinc-50">
                  Agent is working
                </span>
              </div>
              <span className="font-mono text-[11px] leading-relaxed text-stone-500 dark:text-zinc-400">
                {generatingStatus.message || "Streaming code changes to the WebContainer runtime..."}
              </span>
              {generatingStatus.filePath && (
                <span className="font-mono text-[11px] text-stone-700 dark:text-zinc-300">
                  {generatingStatus.filePath}
                  {generatingStatus.linesCount !== undefined && ` (${generatingStatus.linesCount} lines)`}
                </span>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-[11px] font-medium text-stone-500 dark:text-zinc-400">
                <Activity className="h-3.5 w-3.5" />
                <span>Try a suggestion</span>
              </div>
              <div className="flex flex-col gap-1.5">
                {promptSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setPrompt(suggestion)}
                    className="rounded-md border border-stone-200 bg-white px-3 py-2 text-left text-[11px] font-medium leading-relaxed text-stone-600 transition-colors hover:border-amber-600/40 hover:text-stone-900 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-amber-400/40 dark:hover:text-zinc-100 cursor-pointer"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Last Run summary */}
          {agentActions.length > 0 && !isGenerating && (
            <div className="flex flex-col gap-2 border-t border-stone-200 pt-4 dark:border-zinc-800">
              <div className="flex items-center justify-between text-[11px] font-medium text-stone-500 dark:text-zinc-400">
                <span className="flex items-center gap-2"><Activity className="h-3.5 w-3.5" /> Last Run</span>
                <span className="font-mono">{agentActions.length} actions</span>
              </div>
              <div className="flex flex-col gap-1">
                {agentActions.map((action, idx) => (
                  <div key={action.id ? `${action.id}-${idx}` : `action-${idx}`} className="flex items-center justify-between gap-2 font-mono text-[11px] text-stone-600 dark:text-zinc-400">
                    <span className="truncate">{action.filePath || action.content.split("\n")[0]}</span>
                    <span className={cn("shrink-0", action.status === "complete" ? "text-emerald-600 dark:text-emerald-400" : "text-stone-400 dark:text-zinc-500")}>{action.type} · {action.status}</span>
                  </div>
                ))}
              </div>
              {agentThought && (
                <p className="line-clamp-4 text-[11px] leading-relaxed text-stone-500 dark:text-zinc-400 hover:line-clamp-none">
                  "{agentThought.split('\n').pop()}"
                </p>
              )}
            </div>
          )}
        </div>

        {/* Bottom Input Area */}
        <div className="shrink-0 border-t border-stone-200 bg-stone-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <form
            onSubmit={handleGenerate}
            className={cn(
              "flex flex-col gap-3 rounded-lg border bg-white p-3 transition-colors dark:bg-zinc-900 focus-within:ring-2 focus-within:ring-amber-600/40 focus-within:border-amber-600/60 dark:focus-within:ring-amber-400/40 dark:focus-within:border-amber-400/60",
              isGenerating
                ? "border-amber-600/60 dark:border-amber-400/60"
                : "border-stone-200 dark:border-zinc-800"
            )}
          >
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating || isBooting}
              placeholder={
                isBooting
                  ? "Booting WebContainer environment..."
                  : isGenerating
                  ? generatingStatus.message || "Streaming..."
                  : "Instruct the agent to build or modify UI..."
              }
              rows={4}
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-stone-900 placeholder:text-stone-400 focus:outline-none dark:text-zinc-50 dark:placeholder:text-zinc-500 disabled:opacity-60"
            />

            <div className="flex items-center justify-between pt-1">
              <div className="flex items-center gap-1.5 text-stone-400 dark:text-zinc-500">
                <Bot className={cn("h-4 w-4", isGenerating ? "text-amber-600 dark:text-amber-400" : "")} />
              </div>
              <button
                type="submit"
                disabled={!prompt.trim() || isGenerating || isBooting}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-md px-4 text-xs font-medium text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                  prompt.trim() && !isGenerating && !isBooting
                    ? "bg-amber-600 hover:bg-amber-700 active:bg-amber-700 dark:bg-amber-500 dark:text-zinc-950 dark:hover:bg-amber-400"
                    : "cursor-not-allowed bg-stone-200 text-stone-400 dark:bg-zinc-800 dark:text-zinc-500"
                )}
              >
                {isBooting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60" />
                    <span>Booting</span>
                  </>
                ) : isGenerating ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60" />
                    <span>Working</span>
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" />
                    <span>Send</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </aside>

      {/* ─── RIGHT: MAIN WORKSPACE ─── */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-stone-100 dark:bg-zinc-950">
        {/* ─── 1. EXPERIMENT HEADER BAR ─── */}
        <header className="flex min-h-12 w-full flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-white px-4 py-2 dark:border-zinc-800 dark:bg-zinc-900 lg:h-12 lg:flex-nowrap lg:py-0 sm:px-4 shrink-0">
          {/* Left: Navigation, Title & Live Status */}
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/lab/experiments"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-stone-200 bg-white text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
              title="Back to Experiments"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </Link>

            <div className="hidden h-5 w-px bg-stone-200 dark:bg-zinc-800 sm:block" />

            <div className="flex min-w-0 flex-col">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-medium text-stone-900 dark:text-zinc-50">
                  Coding Agent Workspace
                </h1>
                <span className="hidden shrink-0 items-center gap-1 rounded-md border border-stone-200 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-500 dark:border-zinc-700 dark:text-zinc-400 sm:inline-flex">
                  WebContainer Wasm
                </span>
              </div>
              <p className="truncate max-w-[280px] text-[11px] text-stone-500 dark:text-zinc-400 sm:max-w-md">
                Active: <span className="font-medium text-stone-700 dark:text-zinc-300">{currentPromptTitle}</span>
              </p>
            </div>
          </div>

          {/* Center: Viewport & View Mode Toggles */}
          <div className="flex items-center gap-2">
            {/* Viewport size switcher */}
            <div className="hidden items-center gap-0.5 rounded-md border border-stone-200 bg-stone-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-950 lg:flex">
              <button
                type="button"
                onClick={() => setViewportSize("desktop")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                  viewportSize === "desktop"
                    ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                )}
                title="Full Width Desktop View"
              >
                <Monitor className="h-3.5 w-3.5" />
                <span className="font-mono">Full</span>
              </button>
              <button
                type="button"
                onClick={() => setViewportSize("tablet")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                  viewportSize === "tablet"
                    ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                )}
                title="Tablet View (768px)"
              >
                <Tablet className="h-3.5 w-3.5" />
                <span className="font-mono">768 px</span>
              </button>
              <button
                type="button"
                onClick={() => setViewportSize("mobile")}
                className={cn(
                  "flex items-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                  viewportSize === "mobile"
                    ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                )}
                title="Mobile View (375px)"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span className="font-mono">375 px</span>
              </button>
            </div>

            {/* View Mode Toggle: Preview vs Code vs Terminal / Activity */}
            <div className="flex items-center gap-0.5 rounded-md border border-stone-200 bg-stone-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-950">
              <button
                type="button"
                onClick={() => setViewMode("preview")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                  viewMode === "preview"
                    ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                )}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Preview</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("code")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                  viewMode === "code"
                    ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                )}
              >
                <Code2 className="h-3.5 w-3.5" />
                <span>Code</span>
              </button>

              <button
                type="button"
                onClick={() => setViewMode("activity")}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                  viewMode === "activity"
                    ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-stone-500 hover:text-stone-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                )}
              >
                <TerminalIcon className="h-3.5 w-3.5" />
                <span>Terminal</span>
                {agentActions.length > 0 && (
                  <span className="rounded-md border border-stone-300 px-1 font-mono text-[10px] text-stone-500 dark:border-zinc-700 dark:text-zinc-400">
                    {agentActions.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Right: Actions & User Menu */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleReset}
              className="flex items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
              title="Reset to default project"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Reset</span>
            </button>

            <div className="h-5 w-px bg-stone-200 dark:bg-zinc-800" />

            <LogoutButton />
          </div>
        </header>

        {/* ─── 2. MAIN EXPERIMENT WORKSPACE ─── */}
        <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          {/* Project Files Navigation Bar */}
          <div className="flex h-9 shrink-0 items-center justify-between border-b border-stone-200 bg-white px-3 dark:border-zinc-800 dark:bg-zinc-900">
            {/* File Tabs */}
            <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pr-2">
              <span className="flex shrink-0 items-center gap-1 pr-1.5 text-[11px] font-medium text-stone-500 dark:text-zinc-400">
                <FolderTree className="h-3.5 w-3.5" />
                <span className="font-mono">VFS</span>
              </span>
              {Object.keys(files).map((fileName) => {
                const isSelected = activeFileName === fileName;
                const isModified = recentModifiedFiles.includes(fileName);
                const badge = getFileBadge(fileName);
                return (
                  <button
                    key={fileName}
                    type="button"
                    onClick={() => {
                      setActiveFileName(fileName);
                      if (viewMode === "activity") setViewMode("code");
                    }}
                    className={cn(
                      "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                      isSelected
                        ? "bg-stone-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-stone-500 hover:bg-stone-100 hover:text-stone-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    )}
                  >
                    <FileCode2 className={cn("h-3.5 w-3.5", isSelected ? "text-amber-400" : "text-stone-400 dark:text-zinc-500")} />
                    <span className="font-mono">{fileName}</span>
                    {isModified && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600 dark:bg-amber-400" title="Updated by Agent" />
                    )}
                    <span className={cn("rounded border px-1 font-mono text-[10px]", badge.color)}>
                      {badge.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Action on file content */}
            {viewMode === "code" && (
              <button
                type="button"
                onClick={handleCopyCode}
                className="ml-2 flex shrink-0 items-center gap-1.5 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span className="hidden sm:inline">Copy Code</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Workspace Display Area */}
          <div className="flex min-h-0 w-full flex-1 items-stretch justify-center overflow-hidden bg-stone-200/50 dark:bg-zinc-950">
            {viewMode === "preview" ? (
              /* Live WebContainer Preview */
              <div
                className={cn(
                  "h-full w-full overflow-hidden",
                  viewportSize === "mobile" && "mx-auto max-w-[375px] border-x border-stone-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                  viewportSize === "tablet" && "mx-auto max-w-[768px] border-x border-stone-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
                  viewportSize === "desktop" && "w-full"
                )}
              >
                <SandboxPreview
                  files={files}
                  className="h-full w-full"
                  keyTrigger={previewRefreshKey}
                  generatingStatus={generatingStatus}
                  previewUrl={previewUrl}
                  isBooting={isBooting}
                  bootMessage={bootMessage}
                  liveLog={liveLog}
                  isGenerating={isGenerating}
                  onReload={() => {
                    terminalRef.current?.writeln("\x1b[1;36m[vite] Manual preview reload triggered.\x1b[0m");
                  }}
                  onSwitchToTerminal={() => {
                    setViewMode("activity");
                    setActivitySubTab("terminal");
                  }}
                  onSwitchToCode={() => setViewMode("code")}
                />
              </div>
            ) : viewMode === "code" ? (
              /* Code Editor with Line Numbers */
              <div className="relative flex h-full w-full overflow-hidden bg-zinc-950">
                <div
                  ref={lineNumbersRef}
                  className="flex shrink-0 select-none flex-col overflow-hidden border-r border-zinc-800 bg-zinc-950 py-3 pl-3 pr-2 text-right font-mono text-[12px] leading-[18px] text-zinc-600"
                  style={{ width: "3.5rem" }}
                >
                  {contentLines.map((_, i) => (
                    <div key={i} className="h-[18px] leading-[18px]">
                      {i + 1}
                    </div>
                  ))}
                </div>

                <textarea
                  readOnly
                  value={activeFile?.content || ""}
                  onScroll={handleEditorScroll}
                  spellCheck={false}
                  className="h-full w-full resize-none overflow-auto whitespace-pre bg-zinc-950 py-3 px-4 font-mono text-[12px] leading-[18px] text-zinc-200 selection:bg-amber-600/30 focus:outline-none"
                />
              </div>
            ) : (
              /* Terminal & Agent Activity Split View */
              <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950">
                {/* Activity Subtabs */}
                <div className="flex h-9 shrink-0 items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setActivitySubTab("terminal")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                        activitySubTab === "terminal"
                          ? "bg-zinc-100 text-zinc-900"
                          : "text-zinc-400 hover:text-zinc-200"
                      )}
                    >
                      <TerminalIcon className="h-3.5 w-3.5" />
                      <span>Terminal</span>
                    </button>
                    <button
                      onClick={() => setActivitySubTab("actions")}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600/50",
                        activitySubTab === "actions"
                          ? "bg-zinc-100 text-zinc-900"
                          : "text-zinc-400 hover:text-zinc-200"
                      )}
                    >
                      <Activity className="h-3.5 w-3.5" />
                      <span>Agent Actions ({agentActions.length})</span>
                    </button>
                  </div>
                </div>

                {/* Subtab Content */}
                <div className="w-full flex-1 overflow-hidden p-3">
                  {activitySubTab === "terminal" ? (
                    <TerminalView ref={terminalRef} className="h-full w-full" />
                  ) : (
                    <div className="h-full w-full space-y-2.5 overflow-y-auto pr-1">
                      {/* Agent Thinking Card */}
                      {agentThought && (
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3.5">
                          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-zinc-200">
                            <Bot className="h-4 w-4 text-amber-400" />
                            <span>Agent Strategy & Thoughts</span>
                          </div>
                          <p className="text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
                            {agentThought}
                          </p>
                        </div>
                      )}

                      {/* Action Items List */}
                      {agentActions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500">
                          <Activity className="mb-2 h-8 w-8 opacity-40" />
                          <p className="text-xs">No agent actions recorded yet. Submit a prompt to start.</p>
                        </div>
                      ) : (
                        agentActions.map((action, idx) => {
                          const isExpanded = expandedActionIndex === idx;
                          const uniqueKey = action.id ? `${action.id}-${idx}` : `action-${idx}`;
                          return (
                            <div
                              key={uniqueKey}
                              className={cn(
                                "rounded-lg border border-zinc-800 bg-zinc-900 p-3",
                                isExpanded && "ring-1 ring-amber-400/40"
                              )}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    className={cn(
                                      "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]",
                                      action.type === "file"
                                        ? "border-amber-400/40 text-amber-400"
                                        : "border-zinc-700 text-zinc-400"
                                    )}
                                  >
                                    {action.type}
                                  </span>
                                  {action.filePath && (
                                    <button
                                      onClick={() => handleSwitchToFile(action.filePath!)}
                                      className="truncate font-mono text-xs text-zinc-300 hover:text-amber-400 hover:underline cursor-pointer"
                                    >
                                      {action.filePath}
                                    </button>
                                  )}
                                </div>
                                <span
                                  className={cn(
                                    "shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px]",
                                    action.status === "complete"
                                      ? "border-emerald-400/40 text-emerald-400"
                                      : "border-amber-400/40 text-amber-400"
                                  )}
                                >
                                  {action.status}
                                </span>
                              </div>

                              {action.content && action.type === "shell" && (
                                <div className="mt-2 rounded border border-zinc-800 bg-zinc-950 p-2 font-mono text-xs text-zinc-300">
                                  $ {action.content}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="flex shrink-0 items-center justify-between border-t border-rose-600/40 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-600 dark:border-rose-400/40 dark:bg-rose-950/50 dark:text-rose-400">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMessage(null)}
              className="rounded-md p-1 transition-colors hover:bg-rose-100 cursor-pointer dark:hover:bg-rose-900/50"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
