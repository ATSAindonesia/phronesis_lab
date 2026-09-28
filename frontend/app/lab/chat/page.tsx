"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowUp,
  Square,
  CircleAlert,
  Brain,
  ChevronDown,
  Plus,
  Trash2,
  X,
  MessageSquare,
  PanelLeft,
  Bot,
  Search,
  Wrench,
  Check,
  Paperclip,
  Mic,
  Share2,
  MoreHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────
// (Identik dengan chat lama — tidak ada perubahan protokol/backend.)

interface ChatMsg {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
}

interface ChatMeta {
  model?: string;
  provider?: string;
  error?: string;
}

interface ChatModel {
  id: string;
  owned_by?: string;
  context_window?: number;
  gangguan?: boolean;
}

type ChatMode = "llm" | "agent";

interface ToolInfo {
  name: string;
  description: string;
  needs_approval: boolean;
}

interface TraceEvent {
  kind: string;
  n?: number;
  of?: number;
  name?: string;
  call_id?: string;
  arguments?: string;
  result?: string;
  ms?: number;
  command?: string;
  approved?: boolean;
  text?: string;
  iterations?: number;
  tools_used?: number;
  truncated?: boolean;
  timeout_sec?: number;
}

interface ApprovalReq {
  call_id: string;
  name: string;
  command: string;
}

const ALL_TOOLS_FALLBACK = [
  "list_files",
  "read_file",
  "server_stats",
  "clock",
  "run_shell",
];

const RESEARCH_STORAGE_KEY = "lab-chat-research";

interface Conversation {
  uuid: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
// (Disalin 1:1 dari chat lama.)

function createSSEParser(onPayload: (payload: string) => void) {
  let buffer = "";
  return {
    push(chunk: string) {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split("\n")) {
          if (line.startsWith("data: ")) onPayload(line.slice(6));
          else if (line.startsWith("data:")) onPayload(line.slice(5).trimStart());
        }
      }
    },
  };
}

function fmtCtx(n?: number): string {
  if (!n || n <= 0) return "";
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(n / 1000)}k`;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString("id-ID", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
}

function dayGroup(iso: string): "today" | "yesterday" | "older" {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "older";
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (diffDays <= 0) return "today";
  if (diffDays === 1) return "yesterday";
  return "older";
}

// ─── Inline markdown mini (bold, italic, inline code) ───────────────────────

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const regex = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-c${i++}`}
          className="rounded bg-[#18181B]/5 px-1.5 py-0.5 font-mono text-[0.85em] text-[#18181B]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i++}`} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    } else {
      nodes.push(<em key={`${keyPrefix}-i${i++}`}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function AssistantContent({ content }: { content: string }) {
  const parts = useMemo(() => content.split(/```/), [content]);
  return (
    <div className="space-y-3">
      {parts.map((part, pi) => {
        if (pi % 2 === 1) {
          const nl = part.indexOf("\n");
          const lang = nl > -1 ? part.slice(0, nl).trim() : "";
          const code = nl > -1 ? part.slice(nl + 1) : part;
          return (
            <div
              key={pi}
              className="overflow-hidden rounded-lg border border-[#E7E5E4]"
            >
              <div className="flex items-center justify-between border-b border-[#E7E5E4] bg-[#FAFAF9] px-3 py-1.5 font-mono text-[11px] text-[#71717A]">
                <span>{lang || "code"}</span>
                <span className="rounded bg-[#18181B] px-1.5 py-0.5 text-[10px] text-white">
                  nova
                </span>
              </div>
              <pre className="overflow-x-auto bg-[#18181B] p-3 font-mono text-[13px] leading-relaxed text-[#FAFAF9]">
                <code>{code.replace(/\n$/, "")}</code>
              </pre>
            </div>
          );
        }
        // Kelompokkan baris quote `>` jadi bubble Quote ala mock.
        const lines = part.split("\n");
        const blocks: { quote: boolean; text: string }[] = [];
        let buf: string[] = [];
        let inQuote = false;
        const flush = () => {
          if (buf.length > 0) {
            blocks.push({ quote: inQuote, text: buf.join("\n") });
            buf = [];
          }
        };
        for (const ln of lines) {
          const isQ = /^\s*>\s?/.test(ln);
          if (blocks.length === 0 && buf.length === 0) inQuote = isQ;
          if (isQ !== inQuote) {
            flush();
            inQuote = isQ;
          }
          buf.push(isQ ? ln.replace(/^\s*>\s?/, "") : ln);
        }
        flush();
        return (
          <div key={pi} className="space-y-3">
            {blocks.map((b, bi) =>
              b.text.trim() === "" ? null : b.quote ? (
                <div
                  key={bi}
                  className="rounded-lg border-l-[3px] border-[#D6D3D1] bg-[#FAFAF9] p-[10px]"
                >
                  <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-[#44403C]">
                    {renderInline(b.text, `p${pi}q${bi}`)}
                  </p>
                </div>
              ) : (
                <p
                  key={bi}
                  className="text-[13px] leading-relaxed whitespace-pre-wrap"
                >
                  {renderInline(b.text, `p${pi}t${bi}`)}
                </p>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Follow-up questions ────────────────────────────────────────────────────

const FOLLOWUP_HEADER = "### Pertanyaan lanjutan";

function parseFollowUps(content: string): string[] {
  const idx = content.indexOf(FOLLOWUP_HEADER);
  if (idx === -1) return [];
  const tail = content.slice(idx + FOLLOWUP_HEADER.length);
  const out: string[] = [];
  for (const line of tail.split("\n")) {
    const m = line.match(/^\s*(?:\d+[.)]|[-*])\s+(.+?)\s*$/);
    if (m && m[1].length > 3 && out.length < 3) out.push(m[1]);
  }
  return out;
}

function FollowUpButtons({
  questions,
  onPick,
}: {
  questions: string[];
  onPick: (q: string) => void;
}) {
  if (questions.length === 0) return null;
  return (
    <div className="mt-3 border-t border-[#E7E5E4] pt-2.5">
      <div className="mb-1.5 font-mono text-[11px] text-[#A1A1AA]">
        pertanyaan lanjutan —
      </div>
      <div className="flex flex-col gap-1.5">
        {questions.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onPick(q)}
            className="rounded-lg border border-[#E7E5E4] px-3 py-1.5 text-left text-[13px] leading-snug text-[#71717A] transition hover:border-[#18181B] hover:text-[#18181B] active:scale-[0.99]"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Thinking block (collapsible) ───────────────────────────────────────────

function ThinkingBlock({
  reasoning,
  active,
}: {
  reasoning: string;
  active: boolean;
}) {
  const [userToggle, setUserToggle] = useState<boolean | null>(null);
  const autoOpen = active && reasoning.length > 0;
  const open = userToggle !== null ? userToggle : autoOpen;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState<number>(0);

  useEffect(() => {
    if (open && bodyRef.current) {
      setMaxH(bodyRef.current.scrollHeight);
    }
  }, [open, reasoning]);

  const label = active
    ? "berpikir…"
    : `berpikir selesai · ${reasoning.length} char`;

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-[#E7E5E4] bg-[#FAFAF9]">
      <button
        type="button"
        onClick={() => setUserToggle(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] text-[#71717A] transition-colors hover:text-[#18181B]"
      >
        <Brain
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-[#18181B]" : "text-[#A1A1AA]"
          )}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 transition-transform duration-300",
            open && "rotate-180"
          )}
        />
      </button>
      <div
        className="transition-[max-height,opacity] duration-300 ease-out"
        style={{
          maxHeight: open ? `${maxH}px` : "0px",
          opacity: open ? 1 : 0,
        }}
      >
        <div
          ref={bodyRef}
          className="max-h-64 overflow-y-auto border-t border-[#E7E5E4] px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[#71717A]"
        >
          {reasoning}
          {active && (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-[#18181B] align-text-bottom" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── History sidebar (Nova) ─────────────────────────────────────────────────

function HistorySidebar({
  conversations,
  activeConv,
  loading,
  onSelect,
  onNew,
  onDelete,
  onClose,
}: {
  conversations: Conversation[];
  activeConv: string | null;
  loading: boolean;
  onSelect: (uuid: string) => void;
  onNew: () => void;
  onDelete: (uuid: string) => void;
  onClose?: () => void;
}) {
  const groups = useMemo(() => {
    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const older: Conversation[] = [];
    for (const c of conversations) {
      const g = dayGroup(c.updated_at);
      if (g === "today") today.push(c);
      else if (g === "yesterday") yesterday.push(c);
      else older.push(c);
    }
    return [
      { label: "HARI INI", items: today },
      { label: "KEMARIN", items: yesterday },
      { label: "SEBELUMNYA", items: older },
    ].filter((g) => g.items.length > 0);
  }, [conversations]);

  const renderItem = (c: Conversation) => {
    const isActive = c.uuid === activeConv;
    return (
      <li key={c.uuid} className="group relative">
        <button
          onClick={() => onSelect(c.uuid)}
          title={c.title}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-[10px] py-2 text-left transition-colors",
            isActive
              ? "bg-white text-[#18181B] outline-1 outline-[#E7E5E4]"
              : "text-[#71717A] hover:bg-[#F5F4F3] hover:text-[#18181B]"
          )}
        >
          {isActive && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#18181B]" />
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] leading-snug">
              {c.title}
            </span>
            <span className="block font-mono text-[10px] text-[#A1A1AA]">
              {c.message_count} pesan · {formatWhen(c.updated_at)}
            </span>
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDelete(c.uuid);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.stopPropagation();
                onDelete(c.uuid);
              }
            }}
            title="Hapus percakapan"
            className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-[#A1A1AA] transition hover:bg-[#E7E5E4] hover:text-[#18181B] group-hover:flex"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-[#FAFAF9]">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="h-[10px] w-[10px] shrink-0 rounded-full bg-[#18181B]" />
          <span className="text-[15px] font-semibold text-[#18181B]">Nova</span>
          {onClose && (
            <button
              onClick={onClose}
              title="Tutup"
              className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[#71717A] transition hover:bg-[#E7E5E4] lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-2 rounded-[10px] bg-[#18181B] p-[10px] text-[13px] font-medium text-white transition hover:bg-[#18181B]/85 active:scale-[0.99]"
        >
          <Plus className="h-[15px] w-[15px]" />
          New chat
        </button>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-[#E7E5E4]/60"
              />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs leading-relaxed text-[#A1A1AA]">
            Belum ada percakapan.
            <br />
            Mulai chat baru — riwayatnya
            <br />
            tersimpan di database.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {groups.map((g) => (
              <div key={g.label}>
                <div className="px-[10px] pt-2 pb-1 font-mono text-[10px] tracking-wide text-[#A1A1AA]">
                  {g.label}
                </div>
                <ul className="space-y-1">{g.items.map(renderItem)}</ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Agent trace row (Nova palette) ─────────────────────────────────────────

function TraceRow({ ev }: { ev: TraceEvent }) {
  const base =
    "flex items-start gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] leading-relaxed";
  switch (ev.kind) {
    case "iteration":
      return (
        <div className={cn(base, "bg-[#F5F4F3] text-[#71717A]")}>
          <span className="shrink-0 font-bold text-[#18181B]">
            #{ev.n}/{ev.of}
          </span>
          <span>iterasi agent</span>
        </div>
      );
    case "tool_call":
      return (
        <div className={cn(base, "bg-[#18181B]/5 text-[#18181B]")}>
          <Wrench className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 flex-1 break-words">
            <span className="font-bold">{ev.name}</span>
            {ev.arguments && ev.arguments !== "{}" && (
              <span className="text-[#71717A]">
                {" "}
                {String(ev.arguments).slice(0, 200)}
              </span>
            )}
          </span>
        </div>
      );
    case "tool_result":
      return (
        <div className={cn(base, "bg-[#FAFAF9] text-[#18181B]")}>
          <span className="shrink-0">→</span>
          <span className="min-w-0 flex-1 break-words">
            <span className="font-bold">{ev.name}</span>
            {typeof ev.ms === "number" && (
              <span className="text-[#A1A1AA]"> ({ev.ms}ms)</span>
            )}
            {ev.result && (
              <span className="mt-0.5 block whitespace-pre-wrap break-words text-[#71717A]">
                {String(ev.result).slice(0, 500)}
              </span>
            )}
          </span>
        </div>
      );
    case "approval_request":
      return (
        <div className={cn(base, "bg-amber-50 text-amber-900")}>
          <span className="shrink-0 animate-pulse">⏳</span>
          <span className="min-w-0 flex-1 break-words">
            minta approval — <code className="break-all">{ev.command}</code>
          </span>
        </div>
      );
    case "approval_decision":
      return (
        <div
          className={cn(
            base,
            ev.approved ? "text-emerald-700" : "text-red-600"
          )}
        >
          <span>{ev.approved ? "✔ disetujui user" : "✘ ditolak user"}</span>
        </div>
      );
    case "note":
      return (
        <div className={cn(base, "text-[#71717A]")}>
          <span className="break-words">{ev.text}</span>
        </div>
      );
    case "nudge":
      return (
        <div className={cn(base, "bg-[#F5F4F3] text-[#18181B]")}>
          <span className="shrink-0 animate-pulse">⚡</span>
          <span className="break-words">{ev.text}</span>
        </div>
      );
    case "done":
      return null;
    default:
      return (
        <div className={cn(base, "text-[#A1A1AA]")}>
          <span className="break-words">{JSON.stringify(ev).slice(0, 200)}</span>
        </div>
      );
  }
}

function ResearchPhases({
  trace,
  done,
}: {
  trace: TraceEvent[];
  done: boolean;
}) {
  const kinds = trace.map((t) => `${t.kind}:${t.name ?? ""}`);
  const hasIter = kinds.some((k) => k.startsWith("iteration"));
  const hasSearch = kinds.some((k) => k === "tool_call:web_search");
  const hasSearchResult = trace.some(
    (t) => t.kind === "tool_result" && t.name === "web_search"
  );
  const hasFetch = kinds.some((k) => k === "tool_call:fetch_url");
  const hasAnswer = done;

  const phases = [
    { label: "Analyzing question", active: hasIter, done: hasSearch || hasAnswer },
    {
      label: "Searching the web",
      active: hasSearch && !hasSearchResult,
      done: hasSearchResult || hasFetch || hasAnswer,
    },
    { label: "Reviewing sources", active: hasFetch && !hasAnswer, done: hasAnswer },
    { label: "Preparing answer", active: hasAnswer, done: hasAnswer },
  ];
  const started = hasIter || trace.length > 0;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[#E7E5E4] px-3 py-2">
      {phases.map((p) => (
        <span
          key={p.label}
          className={cn(
            "flex items-center gap-1.5 font-mono text-[11px]",
            p.done
              ? "text-emerald-700"
              : p.active ||
                  (started && !hasAnswer && p.label === "Analyzing question")
                ? "text-[#18181B]"
                : "text-[#A1A1AA]"
          )}
        >
          {p.done ? (
            <Check className="h-3 w-3" />
          ) : p.active ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-[#18181B]" />
          ) : (
            <span className="h-2 w-2 rounded-full bg-[#E7E5E4]" />
          )}
          {p.label}
        </span>
      ))}
    </div>
  );
}

// ─── Nova model dropdown (ganti AnimatedDropdown yang bertema gelap) ────────

function ModelMenu({
  models,
  activeModelId,
  modelLabel,
  providerLabel,
  onPick,
}: {
  models: ChatModel[];
  activeModelId?: string;
  modelLabel: string;
  providerLabel: string;
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open ]);

  return (
    <div ref={wrapRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => models.length > 0 && setOpen((v) => !v)}
        title={
          models.length > 0 ? "Pilih model" : "Model aktif dari server"
        }
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] font-medium text-[#18181B] transition hover:bg-[#F5F4F3]"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#18181B] opacity-30" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-[#18181B]" />
        </span>
        <span className="max-w-[160px] truncate">{modelLabel}</span>
        <span className="hidden font-mono text-[11px] font-normal text-[#A1A1AA] xl:inline">
          · {providerLabel}
        </span>
        {models.length > 0 && (
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 text-[#A1A1AA] transition-transform",
              open && "rotate-180"
            )}
          />
        )}
      </button>
      {open && models.length > 0 && (
        <div className="absolute top-[calc(100%+8px)] right-0 z-50 max-h-72 w-72 overflow-y-auto rounded-xl border border-[#E7E5E4] bg-white p-1.5 shadow-xl">
          {models.map((m) => {
            const desc = [m.owned_by, fmtCtx(m.context_window) ? `${fmtCtx(m.context_window)} ctx` : ""]
              .filter(Boolean)
              .join(" · ");
            const active = activeModelId === m.id;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  onPick(m.id);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-[#F5F4F3]",
                  active ? "text-[#18181B]" : "text-[#71717A]"
                )}
              >
                {m.gangguan && (
                  <span
                    title="Model sedang gangguan"
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {m.id}
                  </span>
                  {desc && (
                    <span className="block truncate text-[11px] text-[#A1A1AA]">
                      {desc}
                    </span>
                  )}
                </span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "Jelasin konsep event loop kayak aku anak SMA",
  "Bikinin contoh regex buat validasi email",
  "Ringkas perbedaan REST vs GraphQL",
  "Ide nama variabel buat fungsi retry + backoff",
];

const LEGACY_STORAGE_KEY = "lab-chat-v1";
const MODEL_STORAGE_KEY = "lab-chat-model";

type NovaSeg = "chat" | "agent" | "search";

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [models, setModels] = useState<ChatModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(true);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const activeConvRef = useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const [mode, setMode] = useState<ChatMode>("llm");
  const [toolCatalog, setToolCatalog] = useState<ToolInfo[]>([]);
  const [enabledTools, setEnabledTools] = useState<string[]>(ALL_TOOLS_FALLBACK);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [turnSummary, setTurnSummary] = useState<string | null>(null);
  const [approval, setApproval] = useState<ApprovalReq | null>(null);
  const turnStartRef = useRef(0);
  const [research, setResearch] = useState(() => {
    try {
      return window.localStorage.getItem(RESEARCH_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const setResearchStored = useCallback((v: boolean) => {
    setResearch(v);
    try {
      window.localStorage.setItem(RESEARCH_STORAGE_KEY, v ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const refreshConversations = useCallback(async (): Promise<
    Conversation[] | null
  > => {
    try {
      const res = await fetch("/api/chat/conversations", { cache: "no-store" });
      if (res.status === 401) {
        setError("Sesi habis — refresh halaman buat login ulang.");
        return null;
      }
      if (!res.ok) return null;
      const data = (await res.json()) as { conversations?: Conversation[] };
      const list = data.conversations ?? [];
      setConversations(list);
      return list;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await refreshConversations();
      if (cancelled) return;
      setConvLoading(false);
      if (list === null) return;

      if (list.length === 0) {
        let legacy: ChatMsg[] = [];
        try {
          const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
          if (raw) {
            const parsed = JSON.parse(raw) as ChatMsg[];
            if (Array.isArray(parsed)) {
              legacy = parsed.filter(
                (m) =>
                  (m.role === "user" || m.role === "assistant") &&
                  typeof m.content === "string" &&
                  m.content.trim() !== ""
              );
            }
          }
        } catch {
          /* ignore */
        }
        if (legacy.length > 0) {
          try {
            const createRes = await fetch("/api/chat/conversations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ title: "Riwayat lama (browser)" }),
            });
            if (createRes.ok) {
              const { conversation } = (await createRes.json()) as {
                conversation: Conversation;
              };
              const saveRes = await fetch(
                `/api/chat/conversations/${conversation.uuid}/messages`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    messages: legacy.map((m) => ({
                      role: m.role,
                      content: m.content,
                      reasoning: m.reasoning || undefined,
                    })),
                  }),
                }
              );
              if (saveRes.ok) {
                try {
                  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
                } catch {
                  /* ignore */
                }
                if (!cancelled) {
                  await refreshConversations();
                  setActiveConv(conversation.uuid);
                  setMessages(legacy);
                }
              }
            }
          } catch {
            /* migrasi gagal — biarkan, jangan blok chat */
          }
        }
      }

      fetch("/api/chat/meta")
        .then((r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
        .then((d: ChatMeta) => {
          if (!cancelled) setMeta(d);
        })
        .catch(() => {
          if (!cancelled) setMeta({ error: "unreachable" });
        });

      fetch("/api/chat/models")
        .then((r) => (r.ok ? r.json() : { models: [] }))
        .then((d: { models?: ChatModel[] }) => {
          if (cancelled) return;
          const list = d.models ?? [];
          setModels(list);
          try {
            const saved = window.localStorage.getItem(MODEL_STORAGE_KEY);
            if (saved && list.some((m) => m.id === saved)) {
              setSelectedModel(saved);
            }
          } catch {
            /* ignore */
          }
        })
        .catch(() => {
          /* daftar model gagal — badge tetap tampil tanpa dropdown */
        });

      fetch("/api/agent/tools")
        .then((r) => (r.ok ? r.json() : { tools: [] }))
        .then((d: { tools?: ToolInfo[] }) => {
          if (cancelled) return;
          if (d.tools && d.tools.length > 0) {
            setToolCatalog(d.tools);
            setEnabledTools(d.tools.map((t) => t.name));
          }
        })
        .catch(() => {
          /* fallback ALL_TOOLS_FALLBACK sudah terisi */
        });
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshConversations]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSidebarOpen(false);
        setMoreOpen(false);
        setToolsOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, error]);

  useEffect(() => {
    activeConvRef.current = activeConv;
  }, [activeConv]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const selectConversation = useCallback(
    async (uuid: string) => {
      if (uuid === activeConv) {
        setSidebarOpen(false);
        return;
      }
      stop();
      setSidebarOpen(false);
      setError(null);
      try {
        const res = await fetch(`/api/chat/conversations/${uuid}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          setError("Gagal memuat percakapan.");
          return;
        }
        const data = (await res.json()) as {
          messages?: {
            uuid: string;
            role: string;
            content: string;
            reasoning?: string | null;
          }[];
        };
        const msgs: ChatMsg[] = (data.messages ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
            reasoning: m.reasoning ?? undefined,
          }));
        setActiveConv(uuid);
        setMessages(msgs);
      } catch {
        setError("Gagal memuat percakapan.");
      }
    },
    [activeConv, stop]
  );

  const newChat = useCallback(() => {
    stop();
    setSidebarOpen(false);
    setActiveConv(null);
    setMessages([]);
    setError(null);
    setInput("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [stop]);

  const deleteConversation = useCallback(
    async (uuid: string) => {
      if (!window.confirm("Hapus percakapan ini beserta semua pesannya?"))
        return;
      try {
        const res = await fetch(`/api/chat/conversations/${uuid}`, {
          method: "DELETE",
        });
        if (!res.ok && res.status !== 404) {
          setError("Gagal menghapus percakapan.");
          return;
        }
        setConversations((prev) => prev.filter((c) => c.uuid !== uuid));
        if (uuid === activeConv) {
          stop();
          setActiveConv(null);
          setMessages([]);
        }
      } catch {
        setError("Gagal menghapus percakapan.");
      }
    },
    [activeConv, stop]
  );

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      setError(null);
      setStreaming(true);
      setInput("");
      requestAnimationFrame(autoResize);

      let convId = activeConv;
      if (!convId) {
        try {
          const res = await fetch("/api/chat/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: content.slice(0, 80) }),
          });
          if (res.status === 401) {
            setError("Sesi habis — refresh halaman buat login ulang.");
            setStreaming(false);
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { conversation: Conversation };
          convId = data.conversation.uuid;
          if (activeConvRef.current !== null && activeConvRef.current !== convId) {
            fetch(`/api/chat/conversations/${convId}`, { method: "DELETE" }).catch(
              () => undefined
            );
            setStreaming(false);
            return;
          }
          setActiveConv(convId);
        } catch {
          setError("Gagal membuat percakapan baru.");
          setStreaming(false);
          return;
        }
      }
      const currentConvId = convId;

      const history = [...messages, { role: "user" as const, content }];
      setMessages([
        ...history,
        { role: "assistant" as const, content: "", reasoning: "" },
      ]);

      try {
        const saveRes = await fetch(
          `/api/chat/conversations/${currentConvId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [{ role: "user", content }] }),
          }
        );
        if (!saveRes.ok) setError("Pesan user gagal tersimpan ke database.");
      } catch {
        setError("Pesan user gagal tersimpan ke database.");
      }

      const controller = new AbortController();
      abortRef.current = controller;

      let accContent = "";
      let accReasoning = "";

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history,
            model: selectedModel ?? undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            /* body bukan json */
          }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSSEParser((payload) => {
          if (payload === "[DONE]") return;
          try {
            const chunk = JSON.parse(payload) as {
              choices?: {
                delta?: {
                  content?: string;
                  reasoning?: string;
                  reasoning_content?: string;
                };
              }[];
              error?: string | { message?: string };
            };
            if (chunk.error) {
              const errMsg =
                typeof chunk.error === "string"
                  ? chunk.error
                  : ((chunk.error as { message?: string })?.message ??
                    "Chat gagal");
              setError(errMsg);
              return;
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) return;
            const rDelta = delta.reasoning ?? delta.reasoning_content ?? "";
            if (delta.content || rDelta) {
              accContent += delta.content ?? "";
              accReasoning += rDelta;
              setMessages((prev) => {
                if (activeConvRef.current !== currentConvId) return prev;
                if (prev.length === 0) return prev;
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = {
                  ...last,
                  role: "assistant",
                  content: last.content + (delta.content ?? ""),
                  reasoning: (last.reasoning ?? "") + rDelta,
                };
                return next;
              });
            }
          } catch {
            // payload bukan json — skip.
          }
        });

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          // User tekan stop — biarin partial text tetap ada.
        } else {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg || "Chat gagal");
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setMessages((prev) => {
          if (activeConvRef.current !== currentConvId) return prev;
          return prev.length > 0 &&
            prev[prev.length - 1].content === "" &&
            !prev[prev.length - 1].reasoning
            ? prev.slice(0, -1)
            : prev;
        });
        if (accContent.trim() !== "" || accReasoning.trim() !== "") {
          fetch(`/api/chat/conversations/${currentConvId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [
                {
                  role: "assistant",
                  content: accContent,
                  reasoning:
                    accReasoning.trim() !== "" ? accReasoning : undefined,
                },
              ],
            }),
          })
            .then((r) => {
              if (!r.ok) throw new Error("save failed");
            })
            .catch(() => setError("Jawaban gagal tersimpan ke database."))
            .finally(() => {
              refreshConversations();
            });
        } else {
          refreshConversations();
        }
      }
    },
    [messages, streaming, activeConv, selectedModel, autoResize, refreshConversations]
  );

  const answerApproval = useCallback(async (callId: string, approve: boolean) => {
    setApproval((cur) => (cur?.call_id === callId ? null : cur));
    try {
      await fetch(`/api/agent/approvals/${encodeURIComponent(callId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
    } catch {
      setError("Gagal mengirim keputusan approval.");
    }
  }, []);

  const sendAgent = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      setError(null);
      setStreaming(true);
      setInput("");
      requestAnimationFrame(autoResize);
      setTrace([]);
      setTurnSummary(null);
      setApproval(null);
      turnStartRef.current = Date.now();

      let convId = activeConv;
      if (!convId) {
        try {
          const res = await fetch("/api/chat/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: content.slice(0, 80) }),
          });
          if (res.status === 401) {
            setError("Sesi habis — refresh halaman buat login ulang.");
            setStreaming(false);
            return;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { conversation: Conversation };
          convId = data.conversation.uuid;
          if (activeConvRef.current !== null && activeConvRef.current !== convId) {
            fetch(`/api/chat/conversations/${convId}`, { method: "DELETE" }).catch(
              () => undefined
            );
            setStreaming(false);
            return;
          }
          setActiveConv(convId);
        } catch {
          setError("Gagal membuat percakapan baru.");
          setStreaming(false);
          return;
        }
      }
      const currentConvId = convId;

      const history = [...messages, { role: "user" as const, content }];
      setMessages([
        ...history,
        { role: "assistant" as const, content: "", reasoning: "" },
      ]);

      try {
        const saveRes = await fetch(
          `/api/chat/conversations/${currentConvId}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [{ role: "user", content }] }),
          }
        );
        if (!saveRes.ok) setError("Pesan user gagal tersimpan ke database.");
      } catch {
        setError("Pesan user gagal tersimpan ke database.");
      }

      const controller = new AbortController();
      abortRef.current = controller;
      let accContent = "";

      const appendAssistant = (delta: string) => {
        accContent += delta;
        setMessages((prev) => {
          if (activeConvRef.current !== currentConvId) return prev;
          if (prev.length === 0) return prev;
          const next = [...prev];
          const last = next[next.length - 1];
          next[next.length - 1] = { ...last, role: "assistant", content: last.content + delta };
          return next;
        });
      };

      const pushTrace = (ev: TraceEvent) => {
        setTrace((prev) => {
          if (activeConvRef.current !== currentConvId) return prev;
          return [...prev.slice(-49), ev];
        });
        if (ev.kind === "approval_request" && ev.call_id) {
          setApproval({
            call_id: String(ev.call_id),
            name: String(ev.name ?? "run_shell"),
            command: String(ev.command ?? ""),
          });
        }
        if (ev.kind === "approval_decision") setApproval(null);
        if (ev.kind === "done") {
          const secs = ((Date.now() - turnStartRef.current) / 1000).toFixed(1);
          setTurnSummary(
            `${ev.iterations ?? "?"} iterasi · ${ev.tools_used ?? 0} tool · ${secs}s${
              ev.truncated ? " · mentok batas" : ""
            }`
          );
        }
      };

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: history.map((m) => ({ role: m.role, content: m.content })),
            model: selectedModel ?? undefined,
            tools: enabledTools,
            max_iterations: research ? 8 : 5,
            temperature: research ? 0.3 : undefined,
            research,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) msg = j.error;
          } catch {
            /* body bukan json */
          }
          throw new Error(msg);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSSEParser((payload) => {
          if (payload === "[DONE]") return;
          try {
            const ev = JSON.parse(payload) as
              | { type: "token"; delta?: string }
              | { type: "trace"; kind?: string; [k: string]: unknown }
              | { type: "error"; error?: string };
            if (ev.type === "token") {
              if (ev.delta) appendAssistant(ev.delta);
              return;
            }
            if (ev.type === "trace") {
              pushTrace(ev as TraceEvent);
              return;
            }
            if (ev.type === "error") {
              setError(ev.error ?? "Agent gagal");
              return;
            }
          } catch {
            // payload bukan envelope agent — skip.
          }
        });

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
      } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg || "Agent gagal");
        }
      } finally {
        abortRef.current = null;
        setStreaming(false);
        setApproval(null);
        setMessages((prev) => {
          if (activeConvRef.current !== currentConvId) return prev;
          return prev.length > 0 && prev[prev.length - 1].content === ""
            ? prev.slice(0, -1)
            : prev;
        });
        if (accContent.trim() !== "") {
          fetch(`/api/chat/conversations/${currentConvId}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              messages: [{ role: "assistant", content: accContent }],
            }),
          })
            .then((r) => {
              if (!r.ok) throw new Error("save failed");
            })
            .catch(() => setError("Jawaban gagal tersimpan ke database."))
            .finally(() => {
              refreshConversations();
            });
        } else {
          refreshConversations();
        }
      }
    },
    [messages, streaming, activeConv, selectedModel, autoResize, refreshConversations, enabledTools, research]
  );

  const submit = useCallback(
    (text: string) => {
      if (research || mode === "agent") sendAgent(text);
      else send(text);
    },
    [research, mode, sendAgent, send]
  );

  const deleteActive = useCallback(() => {
    if (!activeConv || messages.length === 0) return;
    deleteConversation(activeConv);
  }, [activeConv, messages.length, deleteConversation]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("Gagal menyalin tautan.");
    }
    setMoreOpen(false);
  }, []);

  // ── Nova header state ──
  const modelLabel = selectedModel ?? meta?.model ?? "Nova 2.5";
  const providerLabel = meta?.provider ?? "tokenportal";
  const activeModelId = selectedModel ?? meta?.model;
  const activeSeg: NovaSeg = research ? "search" : mode === "agent" ? "agent" : "chat";

  const pickModel = (id: string) => {
    setSelectedModel(id);
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const pickSeg = (seg: NovaSeg) => {
    if (seg === "search") {
      setResearchStored(true);
    } else {
      setResearchStored(false);
      setMode(seg === "agent" ? "agent" : "llm");
    }
  };

  const segBtn = (seg: NovaSeg, Icon: typeof MessageSquare, label: string) => {
    const on = activeSeg === seg;
    return (
      <button
        key={seg}
        type="button"
        onClick={() => pickSeg(seg)}
        title={seg === "chat" ? "Chat langsung" : seg === "agent" ? "Agent + tools" : "Riset web mendalam"}
        className={cn(
          "flex items-center gap-1.5 rounded-[7px] px-[10px] py-[6px] text-[12px] font-medium transition",
          on ? "bg-[#18181B] text-white" : "text-[#71717A] hover:text-[#18181B]"
        )}
      >
        <Icon className="h-[13px] w-[13px]" />
        {label}
      </button>
    );
  };

  const sidebarProps = {
    conversations,
    activeConv,
    loading: convLoading,
    onSelect: selectConversation,
    onNew: newChat,
    onDelete: deleteConversation,
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-white font-[Inter,system-ui,sans-serif] text-[#18181B]">
      {/* Dekor stone halus (pengganti Dragon BG jpeg 1MB+ di mock) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(24,24,27,0.06) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      {/* ── Sidebar desktop ── */}
      <aside className="relative z-10 hidden w-[248px] shrink-0 flex-col justify-between border-r border-[#E7E5E4] bg-[#FAFAF9] p-[20px_14px_16px_14px] lg:flex">
        <HistorySidebar {...sidebarProps} />
        <p className="mt-3 px-1 font-mono text-[10px] leading-relaxed text-[#A1A1AA]">
          Riwayat tersimpan di database lab.
        </p>
      </aside>

      {/* ── Drawer mobile ── */}
      <div
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          "fixed inset-0 z-[55] bg-black/30 transition-opacity duration-300 lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[60] flex w-72 max-w-[85vw] flex-col border-r border-[#E7E5E4] bg-[#FAFAF9] p-[20px_14px_16px_14px] shadow-2xl transition-transform duration-300 ease-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <HistorySidebar
          {...sidebarProps}
          onClose={() => setSidebarOpen(false)}
        />
      </aside>

      {/* ── Kolom utama ── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col bg-white">
        {/* Header */}
        <header className="flex items-center justify-between gap-2 border-b border-[#E7E5E4] bg-white px-4 py-[14px] sm:px-8">
          {/* Kiri: hamburger (mobile) + share + more — sesuai urutan mock */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setSidebarOpen(true)}
              title="Riwayat chat"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#A1A1AA] transition hover:bg-[#F5F4F3] hover:text-[#18181B] lg:hidden"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <button
              onClick={copyLink}
              title={copied ? "Tautan disalin!" : "Salin tautan percakapan"}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-[#A1A1AA] transition hover:bg-[#F5F4F3] hover:text-[#18181B]"
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-600" />
              ) : (
                <Share2 className="h-4 w-4" />
              )}
            </button>
            <div className="relative">
              <button
                onClick={() => setMoreOpen((v) => !v)}
                title="Opsi lainnya"
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg transition",
                  moreOpen
                    ? "bg-[#F5F4F3] text-[#18181B]"
                    : "text-[#A1A1AA] hover:bg-[#F5F4F3] hover:text-[#18181B]"
                )}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {moreOpen && (
                <>
                  <div
                    className="fixed inset-0 z-30"
                    onClick={() => setMoreOpen(false)}
                  />
                  <div className="absolute left-0 z-40 mt-2 w-52 rounded-xl border border-[#E7E5E4] bg-white p-1.5 shadow-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        newChat();
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#18181B] transition hover:bg-[#F5F4F3]"
                    >
                      <Plus className="h-3.5 w-3.5 text-[#A1A1AA]" />
                      Chat baru
                    </button>
                    <button
                      type="button"
                      onClick={copyLink}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#18181B] transition hover:bg-[#F5F4F3]"
                    >
                      <Share2 className="h-3.5 w-3.5 text-[#A1A1AA]" />
                      Salin tautan
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMoreOpen(false);
                        deleteActive();
                      }}
                      disabled={!activeConv || messages.length === 0}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Hapus percakapan ini
                    </button>
                  </div>
                </>
              )}
            </div>
            {(mode === "agent" || research) && (
              <div className="relative hidden sm:block">
                <button
                  type="button"
                  onClick={() => setToolsOpen((v) => !v)}
                  title="Pilih tools agent"
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] transition",
                    toolsOpen
                      ? "border-[#18181B] bg-[#18181B] text-white"
                      : "border-[#E7E5E4] text-[#71717A] hover:text-[#18181B]"
                  )}
                >
                  <Wrench className="h-3.5 w-3.5" />
                  {enabledTools.length}/
                  {toolCatalog.length || ALL_TOOLS_FALLBACK.length}
                </button>
                {toolsOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setToolsOpen(false)}
                    />
                    <div className="absolute left-0 z-40 mt-2 w-64 rounded-xl border border-[#E7E5E4] bg-white p-2 shadow-xl">
                      <p className="px-2 pt-1 pb-1.5 font-mono text-[10px] tracking-wide text-[#A1A1AA] uppercase">
                        Tools agent
                      </p>
                      {(toolCatalog.length > 0
                        ? toolCatalog
                        : ALL_TOOLS_FALLBACK.map((n) => ({
                            name: n,
                            description: "",
                            needs_approval: n === "run_shell",
                          }))
                      ).map((t) => {
                        const on = enabledTools.includes(t.name);
                        return (
                          <button
                            key={t.name}
                            type="button"
                            onClick={() =>
                              setEnabledTools((prev) =>
                                prev.includes(t.name)
                                  ? prev.filter((x) => x !== t.name)
                                  : [...prev, t.name]
                              )
                            }
                            title={t.description}
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-[#F5F4F3]"
                          >
                            <span
                              className={cn(
                                "flex h-4 w-4 items-center justify-center rounded border text-[10px]",
                                on
                                  ? "border-[#18181B] bg-[#18181B] text-white"
                                  : "border-[#E7E5E4] text-transparent"
                              )}
                            >
                              ✓
                            </span>
                            <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#18181B]">
                              {t.name}
                            </span>
                            {t.needs_approval && (
                              <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[9px] text-amber-800">
                                approval
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Kanan: model + segmen — sesuai urutan mock */}
          <div className="flex min-w-0 items-center gap-3">
            <ModelMenu
              models={models}
              activeModelId={activeModelId}
              modelLabel={modelLabel}
              providerLabel={providerLabel}
              onPick={pickModel}
            />
            <div className="flex items-center gap-1 rounded-[10px] border border-[#E7E5E4] bg-[#F5F4F3] p-1">
              {segBtn("chat", MessageSquare, "Chat")}
              {segBtn("agent", Bot, "Agent")}
              {segBtn("search", Search, "Search")}
            </div>
          </div>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-[960px] flex-col items-center px-4 pt-5 pb-2 sm:px-8">
            <h1 className="text-center text-[24px] font-semibold text-[#18181B]">
              Halo
            </h1>
            <p className="mt-1 text-center text-[15px] text-[#71717A]">
              Apa yang bisa saya bantu hari ini?
            </p>

            {messages.length === 0 && !streaming && (
              <div className="mt-5 flex w-full flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => submit(s)}
                    className="rounded-full border border-[#E7E5E4] bg-white px-3.5 py-1.5 text-xs text-[#71717A] transition hover:border-[#18181B] hover:text-[#18181B] active:scale-95"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-4 flex w-full flex-col gap-[14px] pb-2">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="flex justify-end">
                    <div className="max-w-[75%] rounded-[14px] bg-[#18181B] p-[14px] text-[13px] leading-relaxed whitespace-pre-wrap text-white">
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-[10px]">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[#18181B]" />
                    <div className="min-w-0 flex-1 rounded-[14px] border border-[#E7E5E4] bg-white p-[14px] text-[13px] text-[#18181B]">
                      {m.reasoning ? (
                        <ThinkingBlock
                          reasoning={m.reasoning}
                          active={
                            streaming && i === messages.length - 1 && !m.content
                          }
                        />
                      ) : null}
                      {m.content ? (
                        <AssistantContent content={m.content} />
                      ) : null}
                      {!streaming || i !== messages.length - 1 ? (
                        <FollowUpButtons
                          questions={parseFollowUps(m.content)}
                          onPick={(q) => submit(q)}
                        />
                      ) : null}
                      {streaming &&
                        i === messages.length - 1 &&
                        m.content !== "" && (
                          <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-[#18181B] align-text-bottom" />
                        )}
                    </div>
                  </div>
                )
              )}

              {(mode === "agent" || research) &&
                (trace.length > 0 || turnSummary) && (
                  <div className="overflow-hidden rounded-[14px] border border-[#E7E5E4] bg-white">
                    <details open={streaming}>
                      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-mono text-[11px] text-[#71717A] hover:text-[#18181B]">
                        <Bot className="h-3.5 w-3.5 text-[#18181B]" />
                        <span className="flex-1">
                          {research ? "research" : "agent"} trace
                          {turnSummary
                            ? ` — ${turnSummary}`
                            : streaming
                              ? " — berjalan…"
                              : ""}
                        </span>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </summary>
                      {research && (
                        <ResearchPhases trace={trace} done={!streaming} />
                      )}
                      <div className="max-h-64 space-y-1 overflow-y-auto border-t border-[#E7E5E4] px-3 py-2">
                        {trace.map((ev, ti) => (
                          <TraceRow key={ti} ev={ev} />
                        ))}
                      </div>
                    </details>
                  </div>
                )}

              {streaming && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-[#A1A1AA]">
                    Nova mengetik
                  </span>
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="nova-typing-dot h-1.5 w-1.5 rounded-full bg-[#D6D3D1]"
                      style={{ animationDelay: `${d * 0.25}s` }}
                    />
                  ))}
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  <CircleAlert className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1">{error}</span>
                  <button
                    onClick={() => setError(null)}
                    className="font-mono text-[11px] underline underline-offset-2"
                  >
                    tutup
                  </button>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>
        </div>

        {/* Input */}
        <div className="px-4 pt-2 pb-6 sm:px-8">
          <div className="mx-auto w-full max-w-[960px]">
            <div className="flex items-center gap-[10px] rounded-[20px] border border-[#E7E5E4] bg-white py-2 pr-2 pl-[14px] shadow-[0px_6px_24px_rgba(0,0,0,0.08)] transition focus-within:border-[#A1A1AA]">
              <button
                type="button"
                disabled
                title="Lampiran segera hadir — belum didukung backend"
                className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg text-[#A1A1AA] opacity-60"
              >
                <Paperclip className="h-4 w-4" />
              </button>
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  autoResize();
                }}
                onKeyDown={onKeyDown}
                rows={1}
                placeholder="Tanyakan apa saja pada Nova..."
                className="max-h-[180px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm text-[#18181B] placeholder:text-[#A1A1AA] focus:outline-none"
              />
              <button
                type="button"
                disabled
                title="Dikte suara belum didukung di browser ini"
                className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg text-[#A1A1AA] opacity-60"
              >
                <Mic className="h-4 w-4" />
              </button>
              {streaming ? (
                <button
                  onClick={stop}
                  title="Stop"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#18181B] text-white transition hover:bg-[#18181B]/85 active:scale-90"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={() => submit(input)}
                  disabled={!input.trim()}
                  title="Kirim (Enter)"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#18181B] text-white transition hover:bg-[#18181B]/85 active:scale-90 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-2 hidden items-center justify-center gap-1.5 text-center font-mono text-[10px] text-[#A1A1AA] sm:flex">
              enter kirim · shift+enter baris baru
              {(mode === "agent" || research) && (
                <span className="inline-flex items-center gap-1 text-[#71717A]">
                  · <Bot className="h-3 w-3" />
                  {research ? "research" : "agent"}: {enabledTools.length} tools
                </span>
              )}
            </p>
            <p className="mt-1 text-center text-[11px] text-[#A1A1AA]">
              Nova dapat membuat kesalahan. Periksa informasi penting.
            </p>
          </div>
        </div>
      </div>

      {/* Modal approval run_shell (mode Agent) */}
      {approval && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#E7E5E4] bg-white p-5 shadow-2xl">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#F5F4F3] text-[#18181B]">
                <Wrench className="h-4 w-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-[#18181B]">
                  Agent minta eksekusi shell
                </h3>
                <p className="font-mono text-[11px] text-[#A1A1AA]">
                  {approval.name} · PROJECT_ROOT · auto-tolak 120 dtk
                </p>
              </div>
            </div>
            <pre className="mt-3 max-h-40 overflow-auto rounded-lg border border-[#E7E5E4] bg-[#FAFAF9] p-3 font-mono text-xs whitespace-pre-wrap break-words text-[#18181B]">
              {approval.command || "(perintah kosong)"}
            </pre>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => answerApproval(approval.call_id, false)}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-red-200 text-sm font-medium text-red-700 transition hover:bg-red-50 active:scale-[0.98]"
              >
                <X className="h-4 w-4" /> Tolak
              </button>
              <button
                type="button"
                onClick={() => answerApproval(approval.call_id, true)}
                disabled={!approval.command?.trim()}
                className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-[#18181B] text-sm font-medium text-white transition hover:bg-[#18181B]/85 active:scale-[0.98] disabled:opacity-40"
              >
                <Check className="h-4 w-4" /> Setujui & jalankan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
