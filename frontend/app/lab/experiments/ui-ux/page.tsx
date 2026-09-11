"use client";

import React, { useState, useRef } from "react";
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
  Terminal,
  Activity,
  CheckCircle2,
  FilePlus,
  FileText,
  Trash2,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import SandboxPreview from "./components/sandbox-preview";
import LogoutButton from "../../logout-button";

interface ProjectFile {
  name: string;
  language: string;
  content: string;
}

interface AgentAction {
  type: string;
  path?: string;
  content?: string;
  command?: string;
  output?: string;
  explanation?: string;
}

const initialFiles: Record<string, ProjectFile> = {
  "src/App.tsx": {
    name: "src/App.tsx",
    language: "typescript",
    content: `import React from "react";

export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 text-slate-100 p-8 font-sans">
      <div className="max-w-md text-center">
        <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-400 to-violet-400 bg-clip-text text-transparent">
          UI/UX Playground
        </h1>
        <p className="mt-3 text-sm text-slate-400 leading-relaxed">
          The sandbox executes the agent project filesystem live. Enter a prompt below to build and modify components.
        </p>
      </div>
    </div>
  );
}`,
  },
  "src/styles.css": {
    name: "src/styles.css",
    language: "css",
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`,
  },
  "package.json": {
    name: "package.json",
    language: "json",
    content: `{
  "name": "workspace",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "lucide-react": "^1.45.0"
  }
}`,
  },
};

const promptSuggestions = [
  "Create a restaurant landing page",
  "Create a developer portfolio",
  "Create a finance dashboard",
  "Change the hero background to blue",
];

export default function UiUxPlaygroundPage() {
  // 1. Basic project/file state (structured files)
  const [files, setFiles] = useState<Record<string, ProjectFile>>(initialFiles);
  const [activeFileName, setActiveFileName] = useState<string>("src/App.tsx");
  const [currentPromptTitle, setCurrentPromptTitle] = useState<string>("Project Sandbox Ready");

  // 2. Prompt input state
  const [prompt, setPrompt] = useState<string>("");

  // 3. Generation UI state
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // 4. Preview panel controls
  const [viewMode, setViewMode] = useState<"preview" | "code" | "activity">("preview");
  const [viewportSize, setViewportSize] = useState<"desktop" | "tablet" | "mobile">("desktop");

  // 5. Agent telemetry state
  const [agentThought, setAgentThought] = useState<string | null>(null);
  const [agentActions, setAgentActions] = useState<AgentAction[]>([]);
  const [recentModifiedFiles, setRecentModifiedFiles] = useState<string[]>([]);
  const [generationPhase, setGenerationPhase] = useState<"idle" | "inspecting" | "architecting" | "verifying">("idle");
  const [expandedActionIndex, setExpandedActionIndex] = useState<number | null>(null);

  // 6. Code editor line numbers ref synchronization
  const lineNumbersRef = useRef<HTMLDivElement>(null);

  // Load existing project files from agent's workspace on mount
  React.useEffect(() => {
    fetch("/api/experiments/files")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.files && Object.keys(data.files).length > 0) {
          setFiles(data.files);
          if (data.files["src/App.tsx"]) {
            setActiveFileName("src/App.tsx");
          } else {
            setActiveFileName(Object.keys(data.files)[0]);
          }
        }
      })
      .catch(() => {});
  }, []);

  const activeFile = files[activeFileName] || Object.values(files)[0];
  const contentLines = (activeFile?.content || "").split("\n");

  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Connected AI generation handler: prompt → AI Agent → structured files + telemetry
  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    setIsGenerating(true);
    setErrorMessage(null);
    setGenerationPhase("inspecting");

    // Dynamic phase transitions for realistic telemetry
    const phaseTimer1 = setTimeout(() => setGenerationPhase("architecting"), 4000);
    const phaseTimer2 = setTimeout(() => setGenerationPhase("verifying"), 16000);

    try {
      const res = await fetch("/api/experiments/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          files: files,
        }),
      });

      clearTimeout(phaseTimer1);
      clearTimeout(phaseTimer2);

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to generate structured files");
      }

      const data = await res.json();

      // Capture agent telemetry
      if (data?.thought) {
        setAgentThought(data.thought);
      }
      if (data?.actions && Array.isArray(data.actions)) {
        setAgentActions(data.actions);
        const touched = data.actions
          .filter((a: AgentAction) => a.type === "write_file" || a.type === "create_file")
          .map((a: AgentAction) => a.path)
          .filter(Boolean);
        setRecentModifiedFiles(touched as string[]);
      }

      if (data?.files && Object.keys(data.files).length > 0) {
        setFiles(data.files);
        setCurrentPromptTitle(prompt.trim());
        setPrompt("");

        if (data.files[activeFileName]) {
          // keep current file focused
        } else if (data.files["src/App.tsx"]) {
          setActiveFileName("src/App.tsx");
        } else {
          setActiveFileName(Object.keys(data.files)[0]);
        }
      }
    } catch (err: unknown) {
      clearTimeout(phaseTimer1);
      clearTimeout(phaseTimer2);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg || "Could not connect to generator. Please verify the service.");
    } finally {
      setIsGenerating(false);
      setGenerationPhase("idle");
    }
  };

  const handleCopyCode = () => {
    if (!activeFile) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleReset = () => {
    setFiles(initialFiles);
    setActiveFileName("src/App.tsx");
    setCurrentPromptTitle("Project Sandbox Ready");
    setPrompt("");
    setErrorMessage(null);
    setAgentThought(null);
    setAgentActions([]);
    setRecentModifiedFiles([]);
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

  const hasBuildVerified = agentActions.some((a) => a.type === "verify_build");

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950 font-sans">
      {/* ─── 1. INTEGRATED EXPERIMENT HEADER BAR ─── */}
      <header className="flex h-16 w-full items-center justify-between border-b border-zinc-200/80 bg-white/90 px-4 sm:px-6 backdrop-blur-md dark:border-zinc-800/80 dark:bg-zinc-950/90 shrink-0 z-20">
        {/* Left: Navigation, Experiment Title & Live Status */}
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
                UI/UX AI Agent Sandbox
              </h1>
              <span className="hidden xs:inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-600 dark:text-blue-400 shrink-0">
                <Bot className="h-3 w-3" />
                Autonomous Engine
              </span>
            </div>
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate max-w-[280px] sm:max-w-md">
              Active: <span className="font-medium text-zinc-700 dark:text-zinc-300">{currentPromptTitle}</span>
            </p>
          </div>
        </div>

        {/* Center: Viewport & View Mode Toggles */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Viewport size switcher (Desktop, Tablet, Mobile) */}
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

          {/* View Mode Toggle: Preview vs Code vs Agent Activity */}
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
              <Activity className="h-3.5 w-3.5" />
              <span>Agent Activity</span>
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
              Files:
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
            /* Live Sandbox Preview Container */
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
                keyTrigger={currentPromptTitle}
                onSwitchToFile={handleSwitchToFile}
                isGenerating={isGenerating}
              />
            </div>
          ) : viewMode === "code" ? (
            /* Interactive Code View Panel with Gutter and Line Numbers */
            <div className="flex h-full w-full flex-col overflow-hidden bg-zinc-950 font-mono text-xs text-zinc-200">
              {/* Code Bar Header */}
              <div className="flex h-9 items-center justify-between border-b border-zinc-800/80 px-4 text-[11px] text-zinc-400 bg-zinc-900/60 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 font-semibold text-blue-400">
                    <FileCode2 className="h-3.5 w-3.5" />
                    {activeFileName}
                  </span>
                  <span className="hidden sm:inline-block text-[10px] text-zinc-500">
                    • {contentLines.length} lines • {(activeFile?.content || "").length} chars
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live Synced
                  </span>
                </div>
              </div>

              {/* Editor Container with Line Numbers Gutter */}
              <div className="flex flex-1 overflow-hidden bg-zinc-950">
                <div
                  ref={lineNumbersRef}
                  className="w-12 select-none border-r border-zinc-800/80 bg-zinc-900/40 py-3 text-right pr-3 font-mono text-[11px] leading-5 text-zinc-600 dark:text-zinc-500 overflow-hidden shrink-0"
                >
                  {contentLines.map((_, i) => (
                    <div key={i}>{i + 1}</div>
                  ))}
                </div>

                <textarea
                  value={activeFile?.content || ""}
                  onChange={(e) => {
                    const newContent = e.target.value;
                    setFiles((prev) => ({
                      ...prev,
                      [activeFileName]: {
                        ...prev[activeFileName],
                        content: newContent,
                      },
                    }));
                  }}
                  onScroll={handleEditorScroll}
                  spellCheck={false}
                  className="flex-1 w-full resize-none bg-transparent p-3 font-mono text-xs leading-5 text-zinc-200 focus:outline-none selection:bg-blue-600/30 overflow-auto"
                />
              </div>
            </div>
          ) : (
            /* ─── 3. AGENT ACTIVITY & TELEMETRY DASHBOARD ─── */
            <div className="flex h-full w-full flex-col overflow-y-auto bg-zinc-950 p-4 sm:p-6 text-zinc-100 font-sans">
              <div className="max-w-4xl mx-auto w-full space-y-6">
                {/* Agent Header Summary Card */}
                <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 sm:p-5 backdrop-blur-xl shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600/15 border border-blue-500/30 text-blue-400">
                      <Bot className="h-6 w-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-sm text-white">Autonomous Agent Loop</h3>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300">
                          Gemini 3.1 Flash + Tools
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400 mt-0.5">
                        Inspection • Filesystem Actions • Terminal Commands • Self-Healing Verification
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {hasBuildVerified ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                        Build Verified (0 errors)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-800/80 px-3 py-1 text-xs font-medium text-zinc-300">
                        <Clock className="h-3.5 w-3.5 text-zinc-400" />
                        Ready
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-xs font-medium text-blue-400">
                      {agentActions.length} Actions
                    </span>
                  </div>
                </div>

                {/* Agent Architectural Reasoning Card */}
                {agentThought && (
                  <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5 shadow-lg">
                    <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-blue-400">
                      <Sparkles className="h-3.5 w-3.5" />
                      Agent Reasoning & Plan
                    </div>
                    <div className="text-xs sm:text-sm text-zinc-200 leading-relaxed whitespace-pre-line font-normal bg-black/30 p-4 rounded-xl border border-zinc-800/60">
                      {agentThought}
                    </div>
                  </div>
                )}

                {/* Autonomous Tool Execution Timeline */}
                <div className="rounded-2xl border border-zinc-800/90 bg-zinc-900/40 p-5 shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                      <Terminal className="h-3.5 w-3.5 text-indigo-400" />
                      Executed Tool Actions Timeline
                    </div>
                    <span className="text-[11px] text-zinc-500 font-mono">
                      Total: {agentActions.length} steps
                    </span>
                  </div>

                  {agentActions.length === 0 ? (
                    <div className="text-center py-10 text-zinc-500 text-xs">
                      No agent actions recorded yet. Enter a prompt below to trigger the autonomous agent loop.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {agentActions.map((action, idx) => {
                        const isExpanded = expandedActionIndex === idx;
                        const isVerify = action.type.includes("verify");
                        const isWrite = action.type === "write_file" || action.type === "create_file";
                        const isDelete = action.type === "delete_file";
                        const isCommand = action.type === "run_terminal_command";

                        return (
                          <div
                            key={idx}
                            className="rounded-xl border border-zinc-800/70 bg-zinc-900/60 p-3 text-xs transition-all hover:border-zinc-700/80"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0">
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-[10px] font-mono text-zinc-400 mt-0.5">
                                  {idx + 1}
                                </span>

                                <div className="min-w-0 space-y-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span
                                      className={cn(
                                        "font-mono font-semibold px-2 py-0.5 rounded text-[10px] uppercase tracking-wider",
                                        isVerify
                                          ? action.type === "verify_build"
                                            ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                                            : "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                                          : isWrite
                                          ? "bg-blue-500/15 text-blue-400 border border-blue-500/30"
                                          : isDelete
                                          ? "bg-rose-500/15 text-rose-400 border border-rose-500/30"
                                          : isCommand
                                          ? "bg-purple-500/15 text-purple-400 border border-purple-500/30"
                                          : "bg-zinc-800 text-zinc-300 border border-zinc-700"
                                      )}
                                    >
                                      {action.type}
                                    </span>

                                    {action.path && (
                                      <button
                                        type="button"
                                        onClick={() => handleSwitchToFile(action.path!)}
                                        className="font-mono text-[11px] text-blue-400 hover:underline cursor-pointer"
                                      >
                                        {action.path}
                                      </button>
                                    )}

                                    {action.command && (
                                      <span className="font-mono text-[11px] text-purple-300 bg-purple-950/40 px-1.5 py-0.5 rounded border border-purple-800/40">
                                        $ {action.command}
                                      </span>
                                    )}
                                  </div>

                                  {action.explanation && (
                                    <p className="text-zinc-300 text-[12px] leading-relaxed">
                                      {action.explanation}
                                    </p>
                                  )}
                                </div>
                              </div>

                              {action.output && (
                                <button
                                  type="button"
                                  onClick={() => setExpandedActionIndex(isExpanded ? null : idx)}
                                  className="text-[11px] text-zinc-400 hover:text-zinc-200 flex items-center gap-1 shrink-0 cursor-pointer pt-0.5"
                                >
                                  <span>{isExpanded ? "Hide" : "Output"}</span>
                                  {isExpanded ? (
                                    <ChevronDown className="h-3 w-3" />
                                  ) : (
                                    <ChevronRight className="h-3 w-3" />
                                  )}
                                </button>
                              )}
                            </div>

                            {/* Expandable output */}
                            {isExpanded && action.output && (
                              <div className="mt-2.5 pt-2 border-t border-zinc-800/60">
                                <pre className="font-mono text-[10px] text-zinc-300 bg-black/60 p-3 rounded-lg overflow-x-auto whitespace-pre-wrap max-h-48 border border-zinc-800/40">
                                  {action.output}
                                </pre>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error Message Alert if Any */}
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

      {/* ─── 4. BOTTOM PROMPT INPUT & ACTIVE AGENT STATUS BAR ─── */}
      <div className="shrink-0 border-t border-zinc-200/80 bg-white/95 px-4 py-3 backdrop-blur-xl dark:border-zinc-800/80 dark:bg-zinc-950/95 z-20">
        <div className="flex flex-col gap-2 max-w-6xl mx-auto">
          {/* Active Generation Phase Pill or Suggestions */}
          {isGenerating ? (
            <div className="flex items-center justify-between rounded-xl bg-blue-500/10 border border-blue-500/25 px-3 py-1.5 text-xs text-blue-400 animate-pulse">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                <span className="font-medium">
                  {generationPhase === "inspecting" && "🔍 Step 1/3: Inspecting workspace filesystem & analyzing domain..."}
                  {generationPhase === "architecting" && "✍️ Step 2/3: Autonomous agent architecting & writing React files..."}
                  {generationPhase === "verifying" && "⚡ Step 3/3: Running controlled terminal build & verifying integrity..."}
                </span>
              </div>
              <span className="text-[10px] text-blue-300/80 font-mono hidden sm:inline">Multi-turn loop active</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar touch-pan-x">
              <span className="text-[11px] font-semibold text-zinc-400 shrink-0">Try:</span>
              {promptSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={isGenerating}
                  onClick={() => setPrompt(suggestion)}
                  className="rounded-lg border border-zinc-200/80 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-850 dark:hover:text-zinc-200 px-2.5 py-1 text-[11px] transition-all whitespace-nowrap cursor-pointer shrink-0"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}

          {/* Input Form with Generate Button */}
          <form
            onSubmit={handleGenerate}
            className={cn(
              "relative flex items-center rounded-2xl border bg-white p-1.5 sm:p-2 shadow-md backdrop-blur-xl transition-all duration-300 dark:bg-zinc-900",
              isGenerating
                ? "border-blue-500/60 ring-2 ring-blue-500/25 dark:border-blue-500/50"
                : "border-zinc-200/90 dark:border-zinc-800/90"
            )}
          >
            <div className="pl-2 sm:pl-3 text-zinc-400 shrink-0">
              <Sparkles className={cn("h-4 w-4", isGenerating ? "text-blue-400 animate-spin" : "text-blue-500")} />
            </div>

            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={isGenerating}
              placeholder={
                isGenerating
                  ? "Autonomous agent is executing tools..."
                  : "Describe changes or new UI (e.g. Create a restaurant landing page)..."
              }
              className="flex-1 min-w-0 bg-transparent px-2.5 sm:px-3 text-xs sm:text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-50 dark:placeholder:text-zinc-500 disabled:opacity-60"
            />

            {/* Generate Button */}
            <button
              type="submit"
              disabled={!prompt.trim() || isGenerating}
              className={cn(
                "flex h-9 sm:h-10 items-center gap-1.5 sm:gap-2 rounded-xl px-3 sm:px-4 text-xs font-semibold text-white shadow-md transition-all duration-200 cursor-pointer shrink-0",
                prompt.trim() && !isGenerating
                  ? "bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 shadow-blue-500/25 hover:from-blue-700 hover:to-violet-700 hover:shadow-blue-500/35 active:scale-95"
                  : "bg-zinc-300 dark:bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none"
              )}
            >
              {isGenerating ? (
                <>
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                  <span className="hidden xs:inline">Agent Working...</span>
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  <span>Generate</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
