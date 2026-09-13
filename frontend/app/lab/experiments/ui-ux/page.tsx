"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Sparkles,
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
  CheckCircle2,
  Cpu,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  FolderOpen,
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
        terminalRef.current?.writeln("\x1b[1;34m[WebContainer] Booting virtual micro-OS...\x1b[0m");

        const container = await getWebContainer();
        if (!isMounted) return;

        terminalRef.current?.writeln("\x1b[1;32m[WebContainer] Virtual filesystem mounted.\x1b[0m");

        // 1. Listen for internal dev server port ready BEFORE spawning commands
        container.on("server-ready", (port, url) => {
          if (!isMounted) return;
          terminalRef.current?.writeln(`\x1b[1;32m[Vite Dev Server] Ready at ${url} (port ${port})\x1b[0m`);
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
          terminalRef.current?.writeln(`\x1b[1;31m[npm Error] Install exited with code ${installExitCode}\x1b[0m`);
          setBootMessage(`npm install failed (exit code ${installExitCode}). Check terminal logs.`);
          setIsBooting(false);
          return;
        }

        terminalRef.current?.writeln("\x1b[1;32m[npm] Dependencies installed successfully.\x1b[0m");

        // 3. Launch Vite dev server directly via npm run dev
        setBootMessage("Starting Vite development server...");
        terminalRef.current?.writeln("\x1b[1;36m[Vite] Starting dev server (npm run dev)...\x1b[0m");

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
          terminalRef.current?.writeln(`\x1b[1;31m[Vite Error] Dev server exited with code ${devExitCode}\x1b[0m`);
          setBootMessage(`Vite dev server exited with code ${devExitCode}. Check terminal.`);
          setIsBooting(false);
        }

      } catch (err: unknown) {
        if (!isMounted) return;
        const msg = err instanceof Error ? err.message : String(err);
        setBootMessage(`WebContainer boot failed: ${msg}`);
        terminalRef.current?.writeln(`\x1b[1;31m[Boot Error] ${msg}\x1b[0m`);
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
      terminalRef.current?.writeln("\x1b[1;33m⚡ [Notice] In-browser WebContainer is initializing. Ready in a few seconds...\x1b[0m");
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

    terminalRef.current?.writeln(`\r\n\x1b[1;35m⚡ [Bolt AI Agent] Prompt: "${userPrompt}"\x1b[0m`);

    const parser = new StreamingActionParser({
      onArtifactStart: ({ title }) => {
        terminalRef.current?.writeln(`\x1b[1;34m📦 Building Artifact: ${title}\x1b[0m`);
        setGeneratingStatus({
          step: "streaming",
          message: `Building Artifact: ${title}`,
        });
      },
      onActionStart: (action) => {
        if (action.type === "file" && action.filePath) {
          const path = action.filePath;
          terminalRef.current?.writeln(`\x1b[1;36m📝 Streaming file: ${path}...\x1b[0m`);

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
          terminalRef.current?.writeln(`\x1b[1;33m$ Preparing shell command: ${action.content || "..."}\x1b[0m`);
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
            terminalRef.current?.writeln(`\x1b[1;32m✓ Applied ${path} to WebContainer (HMR updated)\x1b[0m`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            terminalRef.current?.writeln(`\x1b[1;31m✗ Failed writing ${path}: ${msg}\x1b[0m`);
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
              terminalRef.current?.writeln(`\x1b[1;32m✓ Command completed: ${commandLine}\x1b[0m`);
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              terminalRef.current?.writeln(`\x1b[1;31m✗ Command failed: ${msg}\x1b[0m`);
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
        terminalRef.current?.writeln(`\x1b[1;32m✓ Artifact finished successfully.\x1b[0m`);
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
                terminalRef.current?.writeln(`\x1b[1;31m[Agent Error] ${parsed.error}\x1b[0m`);
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
      terminalRef.current?.writeln(`\x1b[1;32m⚡ AI agent generation complete.\x1b[0m\r\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      terminalRef.current?.writeln(`\x1b[1;31m[Error] ${msg}\x1b[0m`);
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
      terminalRef.current?.writeln("\x1b[1;33m[Reset] Workspace reset to starter template.\x1b[0m");
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
      return { label: "TSX", color: "text-blue-400 bg-blue-500/10 border-blue-500/20" };
    }
    if (fileName.endsWith(".css")) {
      return { label: "CSS", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
    }
    return { label: "TS", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" };
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-zinc-50 dark:bg-zinc-950 font-sans">
      
      {/* ─── LEFT: AGENT SIDEPANEL ─── */}
      <aside className="flex h-screen w-80 flex-col border-r border-zinc-200/80 bg-white/90 dark:border-zinc-800/80 dark:bg-zinc-950/90 backdrop-blur-xl shrink-0 transition-all z-30 shadow-xl">
        {/* Header */}
        <div className="flex h-16 items-center gap-3 border-b border-zinc-200/80 px-5 dark:border-zinc-800/80 shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 shadow-md shadow-blue-500/20 text-white">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
              Agent Control
            </div>
            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
              Bolt.new AI Assistant
            </div>
          </div>
        </div>

        {/* Main Content Area (Suggestions, History, etc.) */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
          {isGenerating ? (
            <div className="flex flex-col gap-3 rounded-2xl bg-blue-500/10 border border-blue-500/25 p-4 text-xs text-blue-400 animate-pulse shadow-inner">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-400 animate-ping" />
                <span className="font-bold tracking-tight text-sm text-blue-500 dark:text-blue-300">
                  Agent is Working...
                </span>
              </div>
              <span className="text-[11px] text-blue-600/80 dark:text-blue-300/80 font-mono leading-relaxed">
                {generatingStatus.message || "Streaming code changes to the WebContainer runtime..."}
              </span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                <Sparkles className="h-3 w-3" />
                <span>Try a Suggestion</span>
              </div>
              <div className="flex flex-col gap-2">
                {promptSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    disabled={isGenerating}
                    onClick={() => setPrompt(suggestion)}
                    className="group relative overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-50 text-left text-zinc-600 hover:bg-white hover:text-blue-600 hover:border-blue-200 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-blue-400 dark:hover:border-blue-900/50 px-3.5 py-2.5 text-[11px] font-medium transition-all cursor-pointer leading-relaxed"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/0 to-blue-500/0 group-hover:from-blue-500/5 group-hover:to-transparent transition-all duration-500" />
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Activity / Thoughts Summary could go here */}
          {agentActions.length > 0 && !isGenerating && (
            <div className="flex flex-col gap-3 mt-4 pt-4 border-t border-zinc-200/50 dark:border-zinc-800/50">
               <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
                <span className="flex items-center gap-2"><Activity className="h-3 w-3" /> Last Run</span>
                <span className="text-zinc-500 dark:text-zinc-400">{agentActions.length} actions</span>
              </div>
              {agentThought && (
                <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-relaxed italic line-clamp-4 hover:line-clamp-none transition-all">
                  "{agentThought.split('\n').pop()}"
                </p>
              )}
            </div>
          )}
        </div>

        {/* Bottom Input Area */}
        <div className="p-4 border-t border-zinc-200/80 dark:border-zinc-800/80 shrink-0 bg-zinc-50/80 dark:bg-zinc-900/80 backdrop-blur-md">
          <form
            onSubmit={handleGenerate}
            className={cn(
              "flex flex-col gap-3 rounded-2xl border bg-white p-3 shadow-sm transition-all duration-300 dark:bg-zinc-950 focus-within:ring-4 focus-within:ring-blue-500/10 focus-within:border-blue-500/50",
              isGenerating
                ? "border-blue-500/60 ring-4 ring-blue-500/10 dark:border-blue-500/50"
                : "border-zinc-200/90 dark:border-zinc-800/90"
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
              className="w-full resize-none bg-transparent text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-50 dark:placeholder:text-zinc-500 disabled:opacity-60"
            />

            <div className="flex items-center justify-between pt-1">
              <div className="text-zinc-400 flex items-center gap-1.5">
                <Sparkles className={cn("h-4 w-4", isGenerating ? "text-blue-400 animate-spin" : "text-blue-500/70")} />
              </div>
              <button
                type="submit"
                disabled={!prompt.trim() || isGenerating || isBooting}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-xl px-4 text-xs font-bold text-white transition-all duration-200 cursor-pointer",
                  prompt.trim() && !isGenerating && !isBooting
                    ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-md shadow-blue-500/25 hover:from-blue-700 hover:to-violet-700 hover:shadow-blue-500/40 active:scale-95"
                    : "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 cursor-not-allowed shadow-none"
                )}
              >
                {isBooting ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-zinc-400/40 border-t-zinc-400" />
                    <span>Booting</span>
                  </>
                ) : isGenerating ? (
                  <>
                    <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
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
      <div className="flex flex-1 flex-col overflow-hidden w-full min-w-0 bg-zinc-50 dark:bg-zinc-950">
        {/* ─── 1. INTEGRATED EXPERIMENT HEADER BAR ─── */}
      <header className="flex h-16 w-full items-center justify-between border-b border-zinc-200/80 bg-white/90 px-4 sm:px-6 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/90 shrink-0 z-20">
        {/* Left: Navigation, Title & Live Status */}
        <div className="flex items-center gap-3.5 min-w-0">
          <Link
            href="/lab/experiments"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200/80 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors shrink-0"
            title="Back to Experiments"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800 hidden sm:block" />

          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-zinc-900 dark:text-zinc-50 truncate">
                Bolt.new Coding Agent
              </h1>
              <span className="hidden xs:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 shrink-0">
                <Cpu className="h-3 w-3" />
                WebContainer Wasm
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[280px] sm:max-w-md">
              Active: <span className="font-medium text-zinc-700 dark:text-zinc-300">{currentPromptTitle}</span>
            </p>
          </div>
        </div>

        {/* Center: Viewport & View Mode Toggles */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Viewport size switcher */}
          <div className="hidden lg:flex items-center rounded-xl border border-zinc-200/80 bg-zinc-100/60 p-0.5 dark:border-zinc-800/80 dark:bg-zinc-900/60">
            <button
              type="button"
              onClick={() => setViewportSize("desktop")}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                viewportSize === "desktop"
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50 font-semibold"
                  : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
              title="Full Width Desktop View"
            >
              <Monitor className="h-3.5 w-3.5" />
              <span className="text-[11px]">Full</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportSize("tablet")}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                viewportSize === "tablet"
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50 font-semibold"
                  : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
              title="Tablet View (768px)"
            >
              <Tablet className="h-3.5 w-3.5" />
              <span className="text-[11px]">768px</span>
            </button>
            <button
              type="button"
              onClick={() => setViewportSize("mobile")}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                viewportSize === "mobile"
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50 font-semibold"
                  : "text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
              )}
              title="Mobile View (375px)"
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span className="text-[11px]">375px</span>
            </button>
          </div>

          {/* View Mode Toggle: Preview vs Code vs Terminal / Activity */}
          <div className="flex items-center rounded-xl border border-zinc-200/80 bg-zinc-100/60 p-0.5 dark:border-zinc-800/80 dark:bg-zinc-900/60 shadow-xs">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                viewMode === "preview"
                  ? "bg-white text-blue-600 shadow-xs dark:bg-zinc-800 dark:text-blue-400"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              <Eye className="h-3.5 w-3.5" />
              <span>Preview</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("code")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer",
                viewMode === "code"
                  ? "bg-white text-blue-600 shadow-xs dark:bg-zinc-800 dark:text-blue-400"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              <Code2 className="h-3.5 w-3.5" />
              <span>Code</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode("activity")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer relative",
                viewMode === "activity"
                  ? "bg-white text-blue-600 shadow-xs dark:bg-zinc-800 dark:text-blue-400"
                  : "text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
              )}
            >
              <TerminalIcon className="h-3.5 w-3.5" />
              <span>Terminal & Log</span>
              {agentActions.length > 0 && (
                <span className="ml-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 text-[10px] px-1.5 py-0.2 font-mono font-bold">
                  {agentActions.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Right: Actions & User Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-200/80 bg-zinc-50 px-2.5 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800/80 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 transition-colors cursor-pointer shadow-xs"
            title="Reset to default project"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>

          <div className="h-5 w-px bg-zinc-200 dark:bg-zinc-800" />

          <LogoutButton />
        </div>
      </header>

      {/* ─── 2. MAIN EXPERIMENT WORKSPACE ─── */}
      <div className="flex flex-1 flex-col overflow-hidden w-full min-h-0 relative">
        {/* Project Files Navigation Bar */}
        <div className="flex h-10 items-center justify-between border-b border-zinc-200/80 bg-zinc-100/70 px-4 dark:border-zinc-800/80 dark:bg-zinc-900/60 shrink-0">
          {/* File Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar touch-pan-x flex-nowrap pr-2">
            <span className="hidden sm:flex items-center gap-1 pr-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400 shrink-0">
              <FolderTree className="h-3 w-3" />
              VFS:
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
                    "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer whitespace-nowrap shrink-0",
                    isSelected
                      ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50 font-semibold ring-1 ring-zinc-200/80 dark:ring-zinc-700/80"
                      : "text-zinc-500 hover:bg-zinc-200/50 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
                  )}
                >
                  <FileCode2 className={cn("h-3.5 w-3.5", isSelected ? "text-blue-500" : "text-zinc-400")} />
                  <span>{fileName}</span>
                  {isModified && (
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" title="Updated by Agent" />
                  )}
                  <span className={cn("text-[9px] font-semibold px-1 py-0.2 rounded border ml-0.5", badge.color)}>
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
              className="flex items-center gap-1.5 rounded-lg border border-zinc-200/80 bg-white/80 px-2 py-1 text-[11px] font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-800/80 dark:text-zinc-300 dark:hover:bg-zinc-700 transition-colors cursor-pointer shrink-0 ml-2"
            >
              {copied ? (
                <>
                  <Check className="h-3 w-3 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3 w-3" />
                  <span className="hidden xs:inline">Copy Code</span>
                </>
              )}
            </button>
          )}
        </div>

        {/* Workspace Display Area */}
        <div className="flex flex-1 items-center justify-center overflow-hidden w-full h-full min-h-0 bg-zinc-200/30 dark:bg-black/30">
          {viewMode === "preview" ? (
            /* Live WebContainer Preview */
            <div
              className={cn(
                "h-full w-full transition-all duration-300 overflow-hidden",
                viewportSize === "mobile" && "max-w-[375px] mx-auto border-x border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 shadow-2xl",
                viewportSize === "tablet" && "max-w-[768px] mx-auto border-x border-zinc-200/80 dark:border-zinc-800/80 bg-white dark:bg-zinc-950 shadow-2xl",
                viewportSize === "desktop" && "w-full bg-transparent"
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
                  terminalRef.current?.writeln("\x1b[1;36m[Preview] Manual preview reload triggered.\x1b[0m");
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
                className="flex flex-col py-4 pl-3 pr-2 text-right font-mono text-xs select-none text-zinc-600 dark:text-zinc-600 bg-zinc-950 border-r border-zinc-850 shrink-0 overflow-hidden"
                style={{ width: "3.5rem" }}
              >
                {contentLines.map((_, i) => (
                  <div key={i} className="h-5 leading-5 text-[11px]">
                    {i + 1}
                  </div>
                ))}
              </div>

              <textarea
                readOnly
                value={activeFile?.content || ""}
                onScroll={handleEditorScroll}
                spellCheck={false}
                className="h-full w-full resize-none bg-zinc-950 p-4 font-mono text-xs leading-5 text-zinc-200 focus:outline-none selection:bg-blue-600/30 selection:text-white overflow-auto whitespace-pre"
              />
            </div>
          ) : (
            /* Terminal & Agent Activity Split View */
            <div className="flex h-full w-full flex-col bg-zinc-950 overflow-hidden">
              {/* Activity Subtabs */}
              <div className="flex h-10 items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-4 shrink-0">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActivitySubTab("terminal")}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer",
                      activitySubTab === "terminal"
                        ? "bg-zinc-800 text-zinc-100 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <TerminalIcon className="h-3.5 w-3.5 text-blue-400" />
                    <span>Interactive Terminal</span>
                  </button>
                  <button
                    onClick={() => setActivitySubTab("actions")}
                    className={cn(
                      "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer",
                      activitySubTab === "actions"
                        ? "bg-zinc-800 text-zinc-100 font-semibold"
                        : "text-zinc-400 hover:text-zinc-200"
                    )}
                  >
                    <Activity className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Agent Actions ({agentActions.length})</span>
                  </button>
                </div>
              </div>

              {/* Subtab Content */}
              <div className="flex-1 w-full overflow-hidden p-3">
                {activitySubTab === "terminal" ? (
                  <TerminalView ref={terminalRef} className="h-full w-full" />
                ) : (
                  <div className="h-full w-full overflow-y-auto space-y-3 pr-2">
                    {/* Agent Thinking Card */}
                    {agentThought && (
                      <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-4 shadow-sm">
                        <div className="flex items-center gap-2 mb-2 text-xs font-bold text-zinc-300">
                          <Bot className="h-4 w-4 text-blue-400" />
                          <span>Agent Strategy & Thoughts</span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                          {agentThought}
                        </p>
                      </div>
                    )}

                    {/* Action Items List */}
                    {agentActions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center p-12 text-center text-zinc-500">
                        <Activity className="h-8 w-8 mb-2 opacity-40" />
                        <p className="text-xs">No agent actions recorded yet. Submit a prompt to start.</p>
                      </div>
                    ) : (
                      agentActions.map((action, idx) => {
                        const isExpanded = expandedActionIndex === idx;
                        const uniqueKey = action.id ? `${action.id}-${idx}` : `action-${idx}`;
                        return (
                          <div
                            key={uniqueKey}
                            className="rounded-xl border border-zinc-800/80 bg-zinc-900/60 p-3.5 transition"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase",
                                    action.type === "file"
                                      ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                                      : "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                                  )}
                                >
                                  {action.type}
                                </span>
                                {action.filePath && (
                                  <button
                                    onClick={() => handleSwitchToFile(action.filePath!)}
                                    className="font-mono text-xs text-blue-400 hover:underline"
                                  >
                                    {action.filePath}
                                  </button>
                                )}
                              </div>
                              <span
                                className={cn(
                                  "text-[10px] font-semibold px-1.5 py-0.5 rounded",
                                  action.status === "complete"
                                    ? "text-emerald-400 bg-emerald-500/10"
                                    : "text-amber-400 bg-amber-500/10"
                                )}
                              >
                                {action.status}
                              </span>
                            </div>

                            {action.content && action.type === "shell" && (
                              <div className="mt-2 text-xs font-mono text-purple-300 bg-black/40 p-2 rounded border border-purple-900/30">
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
        <div className="flex items-center justify-between border-t border-rose-500/25 bg-rose-500/10 px-4 py-2 text-xs font-medium text-rose-300 shrink-0">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="rounded-lg p-1 text-rose-400 hover:bg-rose-500/20 hover:text-rose-200 transition-colors cursor-pointer"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ─── BOTTOM PROMPT INPUT REMOVED - MOVED TO SIDEPANEL ─── */}
      </div>
    </div>
  );
}
