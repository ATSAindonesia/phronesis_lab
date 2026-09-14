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
  FlaskConical,
  Eraser,
  Square,
  CircleAlert,
  Brain,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

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

const STORAGE_KEY = "lab-chat-v1";
const MAX_STORED = 100;
const MAX_REASONING_STORED = 4000;

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadHistory(): ChatMsg[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ChatMsg[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (m) =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .slice(-MAX_STORED);
  } catch {
    return [];
  }
}

function saveHistory(msgs: ChatMsg[]) {
  try {
    const trimmed = msgs.slice(-MAX_STORED).map((m) => ({
      ...m,
      reasoning:
        m.reasoning && m.reasoning.length > MAX_REASONING_STORED
          ? m.reasoning.slice(0, MAX_REASONING_STORED) + "…"
          : m.reasoning,
    }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // storage penuh / disabled — abaikan.
  }
}

// Parser SSE minimal: feed chunk teks, keluarin payload per event "data:".
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
          className="rounded bg-zinc-200/70 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"
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
  // Split per code block ``` ... ``` sisanya paragraf.
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
              className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
            >
              <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100 px-3 py-1.5 font-mono text-[11px] text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-500">
                <span>{lang || "code"}</span>
                <span className="text-amber-600 dark:text-amber-400">lab</span>
              </div>
              <pre className="overflow-x-auto bg-zinc-50 p-3 font-mono text-[13px] leading-relaxed text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                <code>{code.replace(/\n$/, "")}</code>
              </pre>
            </div>
          );
        }
        return (
          <p key={pi} className="whitespace-pre-wrap leading-relaxed">
            {renderInline(part, `p${pi}`)}
          </p>
        );
      })}
    </div>
  );
}

// ─── Thinking block (collapsible, smooth height) ────────────────────────────

function ThinkingBlock({
  reasoning,
  active,
}: {
  reasoning: string;
  active: boolean;
}) {
  // active = reasoning masih mengalir utk pesan ini.
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
    <div className="lab-anim-in mb-3 overflow-hidden rounded-xl border border-zinc-200/80 bg-zinc-100/60 dark:border-zinc-800/80 dark:bg-zinc-900/50">
      <button
        type="button"
        onClick={() => setUserToggle(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        <Brain
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-amber-500" : "text-zinc-400 dark:text-zinc-500"
          )}
        />
        <span className={cn("min-w-0 flex-1 truncate", active && "lab-shimmer-text")}>
          {label}
        </span>
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
          className="max-h-64 overflow-y-auto border-t border-zinc-200/70 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-zinc-500 dark:border-zinc-800/70 dark:text-zinc-400"
        >
          {reasoning}
          {active && (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-amber-500 align-text-bottom" />
          )}
        </div>
      </div>
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

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<ChatMeta | null>(null);
  const [loaded, setLoaded] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Restore history + fetch meta sekali di mount.
  useEffect(() => {
    setMessages(loadHistory());
    setLoaded(true);
    fetch("/api/chat/meta")
      .then((r) => (r.ok ? r.json() : { error: `HTTP ${r.status}` }))
      .then((d: ChatMeta) => setMeta(d))
      .catch(() => setMeta({ error: "unreachable" }));
  }, []);

  // Persist tiap perubahan (kecuali lagi streaming).
  useEffect(() => {
    if (loaded && !streaming) saveHistory(messages);
  }, [messages, loaded, streaming]);

  // Auto-scroll ke bawah.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, error]);

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

  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || streaming) return;

      setError(null);
      const history = [...messages, { role: "user" as const, content }];
      setMessages([
        ...history,
        { role: "assistant" as const, content: "", reasoning: "" },
      ]);
      setInput("");
      setStreaming(true);
      requestAnimationFrame(autoResize);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
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
                delta?: { content?: string; reasoning?: string };
              }[];
              error?: string;
            };
            if (chunk.error) {
              setError(chunk.error);
              return;
            }
            const delta = chunk.choices?.[0]?.delta;
            if (!delta) return;
            if (delta.content || delta.reasoning) {
              setMessages((prev) => {
                if (prev.length === 0) return prev;
                const next = [...prev];
                const last = next[next.length - 1];
                next[next.length - 1] = {
                  ...last,
                  role: "assistant",
                  content: last.content + (delta.content ?? ""),
                  reasoning: (last.reasoning ?? "") + (delta.reasoning ?? ""),
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
        // Buang assistant bubble kosong kalau gak dapet apa-apa.
        setMessages((prev) =>
          prev.length > 0 &&
          prev[prev.length - 1].content === "" &&
          !prev[prev.length - 1].reasoning
            ? prev.slice(0, -1)
            : prev
        );
      }
    },
    [messages, streaming, autoResize]
  );

  const clearChat = useCallback(() => {
    if (messages.length === 0) return;
    if (!window.confirm("Hapus semua riwayat chat?")) return;
    stop();
    setMessages([]);
    setError(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, [messages.length, stop]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const modelLabel = meta?.model ?? "…";
  const providerLabel = meta?.provider ?? "tokenportal";

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-950">
      {/* Dekor: dot grid halus + glow amber di pojok */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35] dark:opacity-[0.2]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(120,113,108,0.35) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl dark:bg-amber-500/10"
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between border-b border-zinc-200/80 bg-white/70 py-3 pl-16 pr-4 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/60 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <FlaskConical className="h-4 w-4" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Chat
            </h1>
            <p className="font-mono text-[11px] text-zinc-500 dark:text-zinc-500">
              completion playground
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 font-mono text-[11px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 sm:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="text-zinc-900 dark:text-zinc-200">
              {modelLabel}
            </span>
            <span className="text-zinc-400 dark:text-zinc-600">·</span>
            <span>{providerLabel}</span>
          </div>
          <button
            onClick={clearChat}
            disabled={messages.length === 0}
            title="Hapus riwayat"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-red-900 dark:hover:text-red-400"
          >
            <Eraser className="h-4 w-4" />
          </button>
        </div>
      </header>

      {/* Thread */}
      <div className="relative z-10 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
          {messages.length === 0 && (
            <div className="lab-anim-in flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
              <div className="font-mono text-5xl text-amber-500/70 dark:text-amber-400/60">
                {"{ }"}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-800 dark:text-zinc-200">
                  Lab Chat siap dicoba
                </h2>
                <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                  Streaming langsung dari TokenPortal. Riwayat disimpan di
                  browser kamu, gak dikirim ke mana-mana.
                </p>
              </div>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="rounded-full border border-zinc-200 bg-white px-3.5 py-1.5 text-xs text-zinc-600 transition hover:border-amber-400/60 hover:text-amber-700 active:scale-95 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:border-amber-500/50 dark:hover:text-amber-400"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="lab-anim-up flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-zinc-900 px-4 py-2.5 text-sm leading-relaxed text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
                  {m.content}
                </div>
              </div>
            ) : (
              <div key={i} className="lab-anim-up flex gap-3">
                <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 font-mono text-[10px] font-bold text-amber-600 dark:text-amber-400">
                  AI
                </div>
                <div className="min-w-0 flex-1 border-l-2 border-amber-400/40 pl-3 text-sm text-zinc-800 dark:border-amber-500/30 dark:text-zinc-200">
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
                  {streaming &&
                    i === messages.length - 1 &&
                    m.content !== "" && (
                      <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-amber-500 align-text-bottom" />
                    )}
                </div>
              </div>
            )
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="relative z-10 mx-auto w-full max-w-3xl px-4 sm:px-6">
          <div className="lab-anim-in mb-2 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            <CircleAlert className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1">{error}</span>
            <button
              onClick={() => setError(null)}
              className="font-mono text-[11px] underline underline-offset-2"
            >
              tutup
            </button>
          </div>
        </div>
      )}

      {/* Input dock */}
      <div
        className="relative z-10 border-t border-zinc-200/80 bg-white/80 backdrop-blur dark:border-zinc-800/80 dark:bg-zinc-900/60"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
          <div className="flex items-end gap-2 rounded-2xl border border-zinc-300 bg-white p-2 shadow-sm transition focus-within:border-amber-400/70 dark:border-zinc-700 dark:bg-zinc-900 dark:focus-within:border-amber-500/50">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                autoResize();
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Tanya apa aja ke lab…"
              className="max-h-[180px] flex-1 resize-none bg-transparent px-2 py-1.5 text-base text-zinc-900 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500 sm:text-sm"
            />
            {streaming ? (
              <button
                onClick={stop}
                title="Stop"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-zinc-900 text-zinc-50 transition hover:bg-zinc-700 active:scale-90 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                onClick={() => send(input)}
                disabled={!input.trim()}
                title="Kirim (Enter)"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white transition hover:bg-amber-600 active:scale-90 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
              >
                <ArrowUp className="h-4 w-4" />
              </button>
            )}
          </div>
          <p className="mt-1.5 hidden px-1 text-center font-mono text-[10px] text-zinc-400 dark:text-zinc-600 sm:block">
            enter kirim · shift+enter baris baru · riwayat: localStorage
          </p>
        </div>
      </div>
    </div>
  );
}
