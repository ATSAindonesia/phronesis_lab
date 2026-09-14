"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Hammer, Loader2 } from "lucide-react";

interface BuilderSession {
  id: string;
  status: "ready" | "running" | "error";
  previewUrl: string;
  previewPath?: string;
  messages: { id: string; role: string; content: string; createdAt: string }[];
  project: { title: string; framework: string; artifacts: { path: string; summary: string }[] };
}

interface AgentEvent {
  type: string;
  message?: {
    content?: Array<{ type: string; text?: string; name?: string; input?: unknown }>;
  };
  tool?: string;
  result?: string;
  error?: string;
}

interface SessionResponse {
  session: BuilderSession;
  eventsUrl?: string;
}

function extractEventContent(event: AgentEvent): string | null {
  switch (event.type) {
    case "assistant": {
      const blocks = event.message?.content;
      if (!Array.isArray(blocks)) return null;
      const parts: string[] = [];
      for (const block of blocks) {
        if (block.type === "text" && block.text) {
          parts.push(block.text);
        } else if (block.type === "tool_use" && block.name) {
          const inputStr = block.input ? JSON.stringify(block.input).slice(0, 160) : "";
          parts.push(`${block.name}(${inputStr}${inputStr.length >= 160 ? "..." : ""})`);
        }
      }
      return parts.join("\n") || null;
    }
    case "tool_use_summary":
      return event.tool ? `→ ${event.tool}` : null;
    case "result":
      return event.result ? String(event.result).slice(0, 300) : "Done.";
    case "turn_complete":
      return null;
    case "error":
      return event.error ?? "Unknown error";
    case "ready":
    case "configured":
      return null;
    default:
      return null;
  }
}

export default function BuilderPage() {
  const [prompt, setPrompt] = useState("");
  const [message, setMessage] = useState("");
  const [session, setSession] = useState<BuilderSession | null>(null);
  const [eventsUrl, setEventsUrl] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<AgentEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  // Preview URL dari backend pakai "localhost" — ganti hostname-nya supaya
  // iframe jalan dari host mana pun (localhost, LAN IP, Tailscale IP).
  useEffect(() => {
    if (!session?.previewUrl) {
      setPreviewSrc(null);
      return;
    }
    const m = session.previewUrl.match(/:(\d{4,5})\/?$/);
    if (m && typeof window !== "undefined") {
      setPreviewSrc(`${window.location.protocol}//${window.location.hostname}:${m[1]}`);
    } else {
      setPreviewSrc(session.previewPath || session.previewUrl);
    }
  }, [session?.previewUrl, session?.previewPath]);

  const canStart = prompt.trim().length > 0 && !loading;
  const canSend = message.trim().length > 0 && session !== null && !loading;

  // Subscribe SSE
  useEffect(() => {
    if (!eventsUrl) return;
    const es = new EventSource(eventsUrl);
    es.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data) as AgentEvent;
        setLiveEvents((prev) => [...prev, parsed]);
        if (parsed.type === "turn_complete") {
          // refresh session snapshot (artifacts/status)
          setSession((prev) => (prev ? { ...prev, status: "ready" } : prev));
        }
      } catch {
        // ignore malformed chunk
      }
    };
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do
    };
    return () => es.close();
  }, [eventsUrl]);

  // Auto-scroll timeline
  useEffect(() => {
    if (timelineRef.current) {
      timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
    }
  }, [liveEvents]);

  async function startSession(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setLiveEvents([]);
    try {
      const res = await fetch("/api/builder/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json()) as SessionResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to start session (${res.status})`);
      setSession(data.session);
      if (data.eventsUrl) setEventsUrl(data.eventsUrl);
      setPrompt("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to start session");
    } finally {
      setLoading(false);
    }
  }

  async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/builder/sessions/${session.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = (await res.json()) as SessionResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || `Failed to send message (${res.status})`);
      setSession(data.session);
      setMessage("");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-md border border-amber-600/30 bg-amber-500/10 text-amber-600 dark:border-amber-400/30 dark:text-amber-400">
          <Hammer className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-stone-900 dark:text-zinc-50">
            Builder
          </h1>
          <p className="text-xs text-stone-500 dark:text-zinc-400">
            Describe an app — the agent builds it in a sandboxed Vite container.
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[1fr_1.2fr_1.2fr]">
        {/* Chat */}
        <section className="flex min-h-0 flex-col rounded-xl border border-stone-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-zinc-400">
            Chat
          </h2>

          {!session ? (
            <form className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={startSession}>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                placeholder="Describe the app you want to build..."
                className="min-h-0 flex-1 resize-none rounded-lg border border-stone-300 bg-stone-50 p-3 text-sm text-stone-900 outline-none ring-amber-500/40 focus:ring dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
              />
              <button
                type="submit"
                disabled={!canStart}
                className="flex items-center justify-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-amber-700 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                {loading ? "Starting..." : "Start building"}
              </button>
            </form>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div
                className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
                style={{ maxHeight: "calc(100vh - 340px)" }}
              >
                {session.messages.map((m) => (
                  <div
                    key={m.id}
                    className={`rounded-lg px-3 py-2 text-sm ${
                      m.role === "user"
                        ? "ml-8 bg-amber-600/10 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                        : "mr-8 bg-stone-100 text-stone-800 dark:bg-zinc-800/60 dark:text-zinc-200"
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  </div>
                ))}
              </div>
              <form className="mt-3 flex gap-2" onSubmit={sendMessage}>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Ask the agent to iterate..."
                  className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 text-sm text-stone-900 outline-none ring-amber-500/40 focus:ring dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100"
                />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {loading ? "..." : "Send"}
                </button>
              </form>
            </div>
          )}
        </section>

        {/* Agent activity */}
        <section className="flex min-h-0 flex-col rounded-xl border border-stone-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-zinc-400">
            Agent Activity
          </h2>
          {!session ? (
            <p className="text-sm text-stone-500 dark:text-zinc-400">
              Start a session to see agent activity.
            </p>
          ) : (
            <div
              ref={timelineRef}
              className="min-h-0 flex-1 space-y-0.5 overflow-y-auto font-mono text-xs"
              style={{ maxHeight: "calc(100vh - 340px)" }}
            >
              {liveEvents.length === 0 && (
                <p className="text-stone-400 dark:text-zinc-500">Waiting for agent...</p>
              )}
              {liveEvents.map((ev, i) => {
                if (ev.type === "ready" || ev.type === "configured") return null;
                if (ev.type === "turn_complete") {
                  return <div key={i} className="my-2 border-t border-stone-200 dark:border-zinc-700/50" />;
                }
                const content = extractEventContent(ev);
                if (!content) return null;
                const isError = ev.type === "error";
                const isToolCall = ev.type === "assistant" && content.includes("(");
                const isText = ev.type === "assistant" && !isToolCall;
                return (
                  <div
                    key={i}
                    className={`rounded px-2 py-1 leading-relaxed ${
                      isError
                        ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                        : isToolCall
                          ? "bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300/80"
                          : isText
                            ? "text-stone-700 dark:text-zinc-300"
                            : "text-stone-500 dark:text-zinc-400"
                    }`}
                  >
                    <span className="whitespace-pre-wrap break-all">{content}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Preview */}
        <section className="flex min-h-0 flex-col rounded-xl border border-stone-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-stone-500 dark:text-zinc-400">
            Preview
          </h2>
          {!session ? (
            <p className="text-sm text-stone-500 dark:text-zinc-400">
              Preview appears after the scaffold is created.
            </p>
          ) : (
            <>
              {previewSrc ? (
                <p className="mb-2 truncate text-[10px] text-stone-400 dark:text-zinc-500">
                  {previewSrc}
                </p>
              ) : null}
              <iframe
                title="Preview"
                src={previewSrc || "about:blank"}
                className="min-h-0 flex-1 rounded-lg border border-stone-200 bg-stone-950 dark:border-zinc-800"
                style={{ minHeight: "calc(100vh - 380px)" }}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
