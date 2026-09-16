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
  Plus,
  Trash2,
  X,
  MessageSquare,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import AnimatedDropdown from "@/components/ui/animated-dropdown";

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

interface ChatModel {
  id: string;
  owned_by?: string;
  context_window?: number;
  gangguan?: boolean;
}

interface Conversation {
  uuid: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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

// Format context window: 131056 -> "131k", 1048560 -> "1M".
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
          className="rounded bg-line px-1.5 py-0.5 font-mono text-[0.85em] text-ink"
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
              className="overflow-hidden rounded-xl border border-line"
            >
              <div className="flex items-center justify-between border-b border-line bg-accent px-3 py-1.5 font-mono text-[11px] text-muted">
                <span>{lang || "code"}</span>
                <span className="text-gold-ink">lab</span>
              </div>
              <pre className="overflow-x-auto bg-paper p-3 font-mono text-[13px] leading-relaxed text-ink">
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
    <div className="lab-anim-in mb-3 overflow-hidden rounded-xl border border-line bg-accent/60">
      <button
        type="button"
        onClick={() => setUserToggle(!open)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[11px] text-muted transition-colors hover:text-ink"
      >
        <Brain
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            active ? "text-gold-ink" : "text-faint"
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
          className="max-h-64 overflow-y-auto border-t border-line px-3 py-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-muted"
        >
          {reasoning}
          {active && (
            <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-gold align-text-bottom" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── History sidebar ────────────────────────────────────────────────────────

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
  return (
    <div className="flex h-full w-full flex-col bg-card backdrop-blur-xl">
      {/* Head: judul + tombol chat baru */}
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-faint">
          Riwayat
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onNew}
            title="Chat baru"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-gold/30 bg-gold/10 px-2.5 text-xs font-medium text-gold-ink transition hover:bg-gold/20 active:scale-95"
          >
            <Plus className="h-3.5 w-3.5" />
            Baru
          </button>
          {onClose && (
            <button
              onClick={onClose}
              title="Tutup"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-accent lg:hidden"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Daftar percakapan */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {loading ? (
          <div className="space-y-1 px-2 py-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-10 animate-pulse rounded-lg bg-accent"
              />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs leading-relaxed text-faint">
            Belum ada percakapan.
            <br />
            Mulai chat baru — riwayatnya
            <br />
            tersimpan di database lab.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const isActive = c.uuid === activeConv;
              return (
                <li key={c.uuid} className="group relative">
                  <button
                    onClick={() => onSelect(c.uuid)}
                    className={cn(
                      "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 pr-9 text-left transition-colors",
                      isActive
                        ? "bg-gold/10 text-ink"
                        : "text-muted hover:bg-accent"
                    )}
                  >
                    <span className="truncate text-[13px] font-medium leading-snug">
                      {c.title}
                    </span>
                    <span className="font-mono text-[10px] text-faint">
                      {c.message_count} pesan · {formatWhen(c.updated_at)}
                    </span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.uuid);
                    }}
                    title="Hapus percakapan"
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-faint opacity-0 transition hover:bg-red-50 hover:text-red-500 focus:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
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

const LEGACY_STORAGE_KEY = "lab-chat-v1";
const MODEL_STORAGE_KEY = "lab-chat-model";

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
  // Ref sinkron buat guard race: stream jalan terus walau user pindah conv.
  const activeConvRef = useRef<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

  // ── Mount: muat daftar percakapan + migrasi localStorage lama → DB ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const list = await refreshConversations();
      if (cancelled) return;
      setConvLoading(false);
      if (list === null) return;

      // Migrasi sekali: riwayat lama di localStorage dipindah ke database
      // sebagai satu percakapan, lalu localStorage dibuang.
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
          // Restore pilihan model terakhir — valid dulu ada di daftar.
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
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshConversations]);

  // Escape nutup drawer riwayat (mobile).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Auto-scroll ke bawah.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, error]);

  // Sinkronkan ref activeConv (dipakai guard di dalam stream send()).
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

  // ── Pilih percakapan: muat pesan dari database ──
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

  // ── Chat baru: kosongkan thread (percakapan dibuat saat kirim pesan pertama) ──
  const newChat = useCallback(() => {
    stop();
    setSidebarOpen(false);
    setActiveConv(null);
    setMessages([]);
    setError(null);
    setInput("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [stop]);

  // ── Hapus percakapan dari database ──
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

      // Pastikan ada percakapan di DB — buat otomatis pakai judul dari
      // pesan pertama.
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
          // User pindah conv pas create in-flight? Batal + hapus conv kosong
          // biar gak jadi sampah, jangan sentuh UI conv yang baru dipilih.
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

      // Simpan pesan user ke DB dulu (await — jaga urutan created_at),
      // lalu mulai streaming. Gagal simpan gak blokir chat.
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

      // Akumulasi jawaban buat disimpan ke DB setelah stream selesai.
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
              // Error upstream bisa string ATAU objek {type, message} —
              // jangan pernah setLangsung nilai objek ke state string,
              // bikin crash render ("Objects are not valid as a React child").
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
            // Beda provider beda nama field reasoning — terima dua-duanya.
            const rDelta = delta.reasoning ?? delta.reasoning_content ?? "";
            if (delta.content || rDelta) {
              accContent += delta.content ?? "";
              accReasoning += rDelta;
              setMessages((prev) => {
                // User pindah conv mid-stream? Jangan sentuh UI conv baru.
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
        // Buang assistant bubble kosong kalau gak dapet apa-apa.
        // Guard: hanya kalau user masih di conv yang sama.
        setMessages((prev) => {
          if (activeConvRef.current !== currentConvId) return prev;
          return prev.length > 0 &&
            prev[prev.length - 1].content === "" &&
            !prev[prev.length - 1].reasoning
            ? prev.slice(0, -1)
            : prev;
        });
        // Simpan jawaban assistant ke DB (partial pun disimpan).
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

  // Eraser: hapus percakapan aktif dari database.
  const deleteActive = useCallback(() => {
    if (!activeConv || messages.length === 0) return;
    deleteConversation(activeConv);
  }, [activeConv, messages.length, deleteConversation]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const modelLabel = selectedModel ?? meta?.model ?? "…";
  const providerLabel = meta?.provider ?? "tokenportal";
  const activeModelId = selectedModel ?? meta?.model;

  const pickModel = (id: string) => {
    setSelectedModel(id);
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-paper">
      {/* Dekor: dot grid halus + glow amber di pojok */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(circle, rgba(120,113,108,0.35) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 right-0 h-64 w-64 rounded-full bg-gold/10 blur-3xl"
      />

      {/* ── Sidebar riwayat: desktop statis, mobile drawer ── */}
      <aside className="relative z-10 hidden w-64 shrink-0 border-r border-line lg:block">
        <HistorySidebar
          conversations={conversations}
          activeConv={activeConv}
          loading={convLoading}
          onSelect={selectConversation}
          onNew={newChat}
          onDelete={deleteConversation}
        />
      </aside>

      {/* Drawer riwayat (mobile/tablet) */}
      <div
        aria-hidden={!sidebarOpen}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          "fixed inset-0 z-[55] bg-ink/40 backdrop-blur-sm transition-opacity duration-300 lg:hidden",
          sidebarOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-[60] flex w-72 max-w-[85vw] flex-col border-r border-line bg-card shadow-2xl transition-transform duration-300 ease-out lg:hidden",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <HistorySidebar
          conversations={conversations}
          activeConv={activeConv}
          loading={convLoading}
          onSelect={selectConversation}
          onNew={newChat}
          onDelete={deleteConversation}
          onClose={() => setSidebarOpen(false)}
        />
      </aside>

      {/* ── Kolom utama: header + thread + input ── */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        {/* Header */}
        {/* Header — z-20 biar dropdown panel gak ketutup thread */}
        <header className="relative z-20 flex items-center justify-between border-b border-line bg-card/85 py-3 pl-16 pr-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              title="Riwayat chat"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-card text-muted transition hover:text-ink lg:hidden"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-gold/30 bg-gold/10 text-gold-ink">
              <FlaskConical className="h-4 w-4" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-ink">
                Chat
              </h1>
              <p className="font-mono text-[11px] text-muted">
                completion playground
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {models.length > 0 ? (
              <AnimatedDropdown
                className="hidden sm:block"
                triggerClassName="h-8 gap-2 rounded-full border-line bg-card px-3 py-1.5 font-mono text-[11px] text-muted hover:bg-card hover:text-ink [&_svg]:h-3.5 [&_svg]:w-3.5"
                text={
                  <span className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                    </span>
                    <span className="text-ink">
                      {modelLabel}
                    </span>
                    <span className="text-faint">·</span>
                    <span>{providerLabel}</span>
                  </span>
                }
                items={models.map((m) => ({
                  name: m.id,
                  description: [
                    m.owned_by,
                    fmtCtx(m.context_window)
                      ? `${fmtCtx(m.context_window)} ctx`
                      : "",
                  ]
                    .filter(Boolean)
                    .join(" · "),
                  danger: m.gangguan,
                  active: activeModelId === m.id,
                }))}
                onSelect={(item) => pickModel(item.name)}
              />
            ) : (
              <div className="hidden items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 font-mono text-[11px] text-muted sm:flex">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span className="text-ink">
                  {modelLabel}
                </span>
                <span className="text-faint">·</span>
                <span>{providerLabel}</span>
              </div>
            )}
            <button
              onClick={newChat}
              title="Chat baru"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-card text-muted transition hover:border-gold/60 hover:text-gold-ink"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              onClick={deleteActive}
              disabled={!activeConv || messages.length === 0}
              title="Hapus percakapan ini"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-card text-muted transition hover:border-red-300 hover:text-red-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Eraser className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Thread */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
            {messages.length === 0 && (
              <div className="lab-anim-in flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
                <div className="font-mono text-5xl text-gold-ink/70">
                  {"{ }"}
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    Lab Chat siap dicoba
                  </h2>
                  <p className="mt-1 max-w-sm text-sm text-muted">
                    Streaming langsung dari TokenPortal. Riwayat percakapan
                    tersimpan di database lab — lanjut kapan aja.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-line bg-card px-3.5 py-1.5 text-xs text-muted transition hover:border-gold/60 hover:text-gold-ink active:scale-95"
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
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-sm leading-relaxed text-paper">
                    {m.content}
                  </div>
                </div>
              ) : (
                <div key={i} className="lab-anim-up flex gap-3">
                  <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-gold/30 bg-gold/10 font-mono text-[10px] font-bold text-gold-ink">
                    AI
                  </div>
                  <div className="min-w-0 flex-1 border-l-2 border-gold/40 pl-3 text-sm text-ink">
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
                        <span className="ml-0.5 inline-block h-4 w-2 animate-pulse bg-gold align-text-bottom" />
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
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            <div className="lab-anim-in mb-2 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
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
          className="border-t border-line bg-card/85 backdrop-blur"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
            <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-card p-2 shadow-sm transition focus-within:border-gold">
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
                className="max-h-[180px] flex-1 resize-none bg-transparent px-2 py-1.5 text-base text-ink placeholder:text-faint focus:outline-none sm:text-sm"
              />
              {streaming ? (
                <button
                  onClick={stop}
                  title="Stop"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-paper transition hover:bg-black active:scale-90"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                </button>
              ) : (
                <button
                  onClick={() => send(input)}
                  disabled={!input.trim()}
                  title="Kirim (Enter)"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold text-ink transition hover:bg-gold active:scale-90 disabled:cursor-not-allowed disabled:bg-line-strong"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1.5 hidden items-center justify-center gap-1.5 px-1 text-center font-mono text-[10px] text-faint sm:flex">
              enter kirim · shift+enter baris baru ·
              <MessageSquare className="h-3 w-3" />
              riwayat: database lab
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
