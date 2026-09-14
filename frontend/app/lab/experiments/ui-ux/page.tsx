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
import { starterFiles } from "./lib/webcontainer";

// Agent action trace (dari event builder API, bukan parser lokal).
interface AgentActionTrace {
  id: string;
  type: "file" | "shell" | "text";
  filePath?: string;
  content: string;
  status: "streaming" | "complete";
}

// System prompt khusus UI/UX design lab — dikirim sebagai agent_config ke
// builder API supaya agent punya "design brain" (bolt.new untuk design).
const DESIGN_SYSTEM_PROMPT = `You are an elite UI/UX design engineer agent (like bolt.new specialized for design) building web apps inside a server-side Docker sandbox running Vite + React + Tailwind CSS.

Respond with a short plan sentence, then exactly ONE <boltArtifact> XML block containing <boltAction> children.

FORMAT (strict):
<boltArtifact id="app" title="Short description">
  <boltAction type="file" filePath="src/App.tsx">
...complete file content...
  </boltAction>
  <boltAction type="shell">
npm install framer-motion
  </boltAction>
</boltArtifact>

RULES:
- filePath relative to project root. Allowed: src/..., public/..., index.html. NEVER emit package.json, vite.config.js, node_modules, package-lock.json.
- File actions REPLACE the file entirely — re-output the WHOLE file when editing.
- The Vite dev server is ALREADY RUNNING with HMR. NEVER emit npm run dev / vite / npm create. Preinstalled: react, react-dom, lucide-react, clsx, tailwind-merge. Only shell-install NEW packages you really need.
- Stack: React 18 + Tailwind CSS v4 (wired via src/index.css @import "tailwindcss";). Entry src/App.jsx MUST export default a component; src/main.jsx renders <App/>.
- Output code that COMPILES: valid TSX, complete files, no placeholders, no TODO stubs, no markdown fences. No text after </boltArtifact>.
- NEVER reference binary assets (images/fonts) you have not created. Do NOT import .png/.jpg/.svg files — use inline SVG, CSS gradients, or https://images.unsplash.com/... URLs instead.

DESIGN BRAIN (this is a UI/UX design lab — design quality is the product):
- Craft production-grade, portfolio-worthy interfaces. Every screen must look intentionally designed, never generated.
- Strong typographic hierarchy (display sizes, tight tracking for headings, generous line-height for body), 8pt spacing rhythm, max-w containers (~1240px), generous whitespace.
- Harmonious palettes: pick ONE intentional palette per request (stone/amber minimal, zinc/emerald tech, warm editorial, etc.) — avoid default blue/purple AI slop. Support dark mode via Tailwind dark: classes when it fits.
- Micro-interactions: hover/active/focus states, smooth transitions (transition-colors/duration-200), subtle motion only where it adds meaning.
- Responsive by default: mobile-first, scoped breakpoints, no horizontal overflow.
- Use lucide-react icons instead of emoji. Real content over lorem ipsum. Empty states and loading states designed, not left blank.`;

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

  // 4. Server Sandbox & Dev Server State (builder API — WebContainer dihapus)
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState<boolean>(false);
  const [bootMessage, setBootMessage] = useState<string>("Server sandbox ready");
  const [liveLog, setLiveLog] = useState<string>("");

  // 5. Agent Telemetry State
  const [agentThought, setAgentThought] = useState<string | null>(null);
  const [agentActions, setAgentActions] = useState<AgentActionTrace[]>([]);
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

  // Server sandbox: tidak perlu boot — sesi builder dibuat lazily saat prompt pertama.


  const activeFile = files[activeFileName] || Object.values(files)[0];
  const contentLines = (activeFile?.content || "").split("\n");

  const handleEditorScroll = (e: React.UIEvent<HTMLTextAreaElement>) => {
    if (lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = e.currentTarget.scrollTop;
    }
  };

  // Server-sandbox generation: builder API (docker) + SSE events.
  // Alur: prompt -> /api/builder/sessions (atau messages) -> agent events
  // (write_file/bash) -> sandbox Vite HMR -> live preview iframe.
  const handleGenerate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!prompt.trim() || isGenerating) return;

    const userPrompt = prompt.trim();
    setIsGenerating(true);
    setErrorMessage(null);
    setCurrentPromptTitle(userPrompt);
    setPrompt("");
    setGeneratingStatus({
      step: "connecting",
      message: "Connecting to design agent (server sandbox)...",
    });

    terminalRef.current?.writeln(`\r\n\x1b[1;33m[agent] Prompt: "${userPrompt}"\x1b[0m`);

    try {
      // 1. Buat sesi (pertama) atau lanjutkan sesi (berikutnya).
      let eventsUrl: string | undefined;
      if (!sessionId) {
        const res = await fetch("/api/builder/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prompt: userPrompt,
            agent_config: { system_prompt: DESIGN_SYSTEM_PROMPT },
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to create session (${res.status})`);
        const sid: string = data.session?.id;
        setSessionId(sid);
        // Preview: pilih bentuk URL sesuai cara akses. Hostname IP
        // (localhost/LAN/Tailscale) -> direct port (HMR jalan). Hostname
        // domain via Cloudflare -> path /b/{port}/ (port non-standar tidak
        // didukung proxy Cloudflare, iframe pakai path yang sama).
        const pv: string | undefined = data.session?.previewUrl;
        const pvPath: string | undefined = data.session?.previewPath;
        if (pv) {
          const m = pv.match(/:(\d{4,5})\/?$/);
          const host = window.location.hostname;
          const isDirect = host === "localhost" || host === "127.0.0.1" || /^\d+\.\d+\.\d+\.\d+$/.test(host);
          if (isDirect && m) setPreviewUrl(`${window.location.protocol}//${host}:${m[1]}`);
          else setPreviewUrl(pvPath || (m ? `/b/${m[1]}/` : pv));
        }
        eventsUrl = data.eventsUrl;
        terminalRef.current?.writeln(`\x1b[1;34m[sandbox] Session ${sid} — Docker sandbox + Vite dev server live\x1b[0m`);
        setBootMessage("Server sandbox live");
      } else {
        const res = await fetch(`/api/builder/sessions/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: userPrompt }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Failed to send message (${res.status})`);
        eventsUrl = `/api/builder/sessions/${sessionId}/events?api_key=lab-local`;
      }

      // 2. Stream agent events via SSE (EventSource butuh api_key di query).
      await new Promise<void>((resolve, reject) => {
        const es = new EventSource(eventsUrl!);
        const timer = setTimeout(() => { es.close(); resolve(); }, 600_000); // hard cap 10 menit
        es.onmessage = (ev) => {
          if (!ev.data || ev.data === "[DONE]") return;
          let parsed: {
            type?: string;
            message?: { content?: Array<{ type?: string; text?: string; name?: string; input?: { path?: string; content?: string; command?: string } }> };
            tool?: string;
            error?: string;
          };
          try { parsed = JSON.parse(ev.data); } catch { return; }

          if (parsed.type === "ready" || parsed.type === "configured") return;

          if (parsed.type === "assistant" && parsed.message?.content) {
            for (const block of parsed.message.content) {
              if (block.type === "text" && block.text) {
                const text = block.text;
                setAgentThought((prev) => (prev ? `${prev}\n${text}` : text));
                terminalRef.current?.writeln(`\x1b[90m[agent] ${block.text}\x1b[0m`);
              } else if (block.type === "tool_use" && block.name === "write_file" && block.input?.path) {
                const path = block.input.path;
                const content = block.input.content ?? "";
                setFiles((prev) => ({
                  ...prev,
                  [path]: {
                    name: path,
                    language: path.endsWith(".css") ? "css" : path.endsWith(".html") ? "html" : path.endsWith(".json") ? "json" : "typescript",
                    content,
                  },
                }));
                setActiveFileName(path);
                setRecentModifiedFiles((prev) => (prev.includes(path) ? prev : [...prev, path]));
                setAgentActions((prev) => [
                  ...prev,
                  { id: `${Date.now()}-${path}`, type: "file", filePath: path, content, status: "complete" },
                ]);
                setGeneratingStatus({ step: "applying", message: `Wrote ${path} to sandbox`, filePath: path });
                terminalRef.current?.writeln(`\x1b[1;32m[ok] ${path} → sandbox (HMR live)\x1b[0m`);
              } else if (block.type === "tool_use" && block.name === "bash" && block.input?.command) {
                const cmd = block.input.command;
                setAgentActions((prev) => [
                  ...prev,
                  { id: `${Date.now()}-sh`, type: "shell", content: cmd, status: "complete" },
                ]);
                setGeneratingStatus({ step: "streaming", message: `Shell: ${cmd}` });
                terminalRef.current?.writeln(`\x1b[1;33m$ ${cmd}\x1b[0m`);
              }
            }
          } else if (parsed.type === "tool_use_summary" && parsed.tool) {
            setLiveLog(parsed.tool);
          } else if (parsed.type === "error" && parsed.error) {
            setErrorMessage(parsed.error);
            terminalRef.current?.writeln(`\x1b[1;31m[err] ${parsed.error}\x1b[0m`);
          } else if (parsed.type === "turn_complete") {
            clearTimeout(timer);
            es.close();
            resolve();
          }
        };
        es.onerror = () => {
          // Backend menutup stream setelah turn selesai; anggap selesai.
          clearTimeout(timer);
          es.close();
          resolve();
        };
      });

      setGeneratingStatus({ step: "ready", message: "Design updated — live preview refreshed!" });
      setPreviewRefreshKey((k) => k + 1);
      terminalRef.current?.writeln(`\x1b[1;32m[ok] Agent turn complete.\x1b[0m\r\n`);
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

    // Reset: buang sesi sandbox (container di-reap oleh backend), mulai baru
    // pada prompt berikutnya.
    setSessionId(null);
    setPreviewUrl(null);
    setBootMessage("Server sandbox ready");
    setFiles(initialDefaultFiles);
    terminalRef.current?.writeln("\x1b[1;33m[fs] Session reset — sandbox baru akan dibuat saat prompt berikutnya.\x1b[0m");
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
                {generatingStatus.message || "Streaming code changes to the server sandbox..."}
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
                  ? "Preparing server sandbox..."
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
                  Docker Sandbox
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
              /* Live Sandbox Preview (iframe ke dev server di Docker) */
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
