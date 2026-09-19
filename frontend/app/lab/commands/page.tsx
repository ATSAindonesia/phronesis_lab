"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronRight,
  Copy,
  Layers,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BashCommand,
  CommandTitle,
  Service,
  ServiceDetail,
  TitleDetail,
} from "./types";
import { useCommandsUrlState } from "./use-commands-url-state";

// ─── API helper ─────────────────────────────────────────────────────────────

async function api<T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`/api/commands${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return parsed as T;
}

// ─── Style tokens ───────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20";
const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-paper transition-colors hover:bg-ink-soft disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";
const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-accent hover:text-ink disabled:opacity-40 cursor-pointer";
const iconBtn =
  "rounded p-1.5 text-faint transition-colors hover:bg-accent hover:text-ink cursor-pointer";

// ─── Panel shell ────────────────────────────────────────────────────────────

function Panel({
  title,
  count,
  actions,
  className,
  children,
}: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-h-0 flex-col bg-paper", className)}>
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-4">
        <div className="flex items-center gap-2 min-w-0">
          <span className="label-caps truncate">{title}</span>
          {typeof count === "number" && (
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-faint">
              {count}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-full border border-line bg-panel text-faint">
        {icon}
      </div>
      <div className="space-y-1">
        <h3 className="font-display text-sm font-medium text-ink">{title}</h3>
        <p className="max-w-xs text-xs leading-relaxed text-muted">{hint}</p>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="flex-1 break-words">{message}</span>
      <button type="button" onClick={onDismiss} className="cursor-pointer text-red-500 hover:text-red-700">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function Row({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-center gap-2 border-b border-line/70 px-4 py-3 text-left transition-colors cursor-pointer",
        active ? "bg-accent" : "hover:bg-accent/50"
      )}
    >
      {children}
    </button>
  );
}

// ─── Main page ──────────────────────────────────────────────────────────────

export default function CommandSetsPage() {
  const { state, navigate } = useCommandsUrlState();
  const { service: serviceId, title: titleId } = state;

  const [services, setServices] = useState<Service[]>([]);
  const [detail, setDetail] = useState<ServiceDetail | null>(null);
  const [titleDetail, setTitleDetail] = useState<TitleDetail | null>(null);

  const [loadingServices, setLoadingServices] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [loadingTitle, setLoadingTitle] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // form: service baru
  const [newService, setNewService] = useState("");
  const [showNewService, setShowNewService] = useState(false);
  // form: judul baru
  const [newTitle, setNewTitle] = useState("");
  const [showNewTitle, setShowNewTitle] = useState(false);
  // form: command baru
  const [newLabel, setNewLabel] = useState("");
  const [newBody, setNewBody] = useState("");
  const [showNewCommand, setShowNewCommand] = useState(false);

  // edit inline
  const [editService, setEditService] = useState<{ name: string } | null>(null);
  const [editTitle, setEditTitle] = useState<{ uuid: string; title: string } | null>(null);
  const [editCommand, setEditCommand] = useState<{
    uuid: string;
    label: string;
    body: string;
  } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Ref guard: hindari race saat user pindah service/judul cepat.
  const activeServiceRef = useRef("");
  const activeTitleRef = useRef("");
  activeServiceRef.current = serviceId;
  activeTitleRef.current = titleId;

  // ── loaders ───────────────────────────────────────────────────────────────

  const loadServices = useCallback(async () => {
    setLoadingServices(true);
    try {
      const res = await api<{ services: Service[] }>("/services");
      setServices(res.services ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat service");
    } finally {
      setLoadingServices(false);
    }
  }, []);

  const loadService = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    setLoadingDetail(true);
    try {
      const res = await api<ServiceDetail>(`/services/${id}`);
      if (activeServiceRef.current !== id) return;
      setDetail(res);
    } catch (err) {
      if (activeServiceRef.current !== id) return;
      setDetail(null);
      setError(err instanceof Error ? err.message : "Gagal memuat detail service");
    } finally {
      if (activeServiceRef.current === id) setLoadingDetail(false);
    }
  }, []);

  const loadTitle = useCallback(async (id: string) => {
    if (!id) {
      setTitleDetail(null);
      return;
    }
    setLoadingTitle(true);
    try {
      const res = await api<TitleDetail>(`/titles/${id}`);
      if (activeTitleRef.current !== id) return;
      setTitleDetail(res);
    } catch (err) {
      if (activeTitleRef.current !== id) return;
      setTitleDetail(null);
      setError(err instanceof Error ? err.message : "Gagal memuat command");
    } finally {
      if (activeTitleRef.current === id) setLoadingTitle(false);
    }
  }, []);

  useEffect(() => {
    loadServices();
  }, [loadServices]);

  useEffect(() => {
    loadService(serviceId);
  }, [serviceId, loadService]);

  useEffect(() => {
    loadTitle(titleId);
  }, [titleId, loadTitle]);

  // ── actions: service ──────────────────────────────────────────────────────

  const submitService = async () => {
    const name = newService.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await api<{ service: Service }>("/services", {
        method: "POST",
        body: { name },
      });
      setNewService("");
      setShowNewService(false);
      await loadServices();
      navigate({ service: res.service.uuid, title: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat service");
    } finally {
      setBusy(false);
    }
  };

  const saveService = async () => {
    if (!detail || !editService) return;
    const name = editService.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api(`/services/${detail.service.uuid}`, {
        method: "PATCH",
        body: { name },
      });
      setEditService(null);
      await Promise.all([loadServices(), loadService(detail.service.uuid)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan service");
    } finally {
      setBusy(false);
    }
  };

  const removeService = async (svc: Service) => {
    if (!window.confirm(`Hapus service "${svc.name}" beserta ${svc.title_count} judul & ${svc.command_count} command di dalamnya?`)) {
      return;
    }
    setBusy(true);
    try {
      await api(`/services/${svc.uuid}`, { method: "DELETE" });
      if (serviceId === svc.uuid) navigate({ service: "", title: "" });
      await loadServices();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus service");
    } finally {
      setBusy(false);
    }
  };

  // ── actions: judul ────────────────────────────────────────────────────────

  const submitTitle = async () => {
    const title = newTitle.trim();
    if (!title || !serviceId) return;
    setBusy(true);
    try {
      const res = await api<{ title: CommandTitle }>(
        `/services/${serviceId}/titles`,
        { method: "POST", body: { title } }
      );
      setNewTitle("");
      setShowNewTitle(false);
      await Promise.all([loadService(serviceId), loadServices()]);
      navigate({ service: serviceId, title: res.title.uuid });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal membuat judul");
    } finally {
      setBusy(false);
    }
  };

  const saveTitle = async () => {
    if (!editTitle) return;
    const title = editTitle.title.trim();
    if (!title) return;
    setBusy(true);
    try {
      await api(`/titles/${editTitle.uuid}`, { method: "PATCH", body: { title } });
      setEditTitle(null);
      await Promise.all([
        loadService(serviceId),
        titleId === editTitle.uuid ? loadTitle(editTitle.uuid) : Promise.resolve(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan judul");
    } finally {
      setBusy(false);
    }
  };

  const removeTitle = async (t: CommandTitle) => {
    if (!window.confirm(`Hapus judul "${t.title}" beserta ${t.command_count} command di dalamnya?`)) {
      return;
    }
    setBusy(true);
    try {
      await api(`/titles/${t.uuid}`, { method: "DELETE" });
      if (titleId === t.uuid) navigate({ service: serviceId, title: "" });
      await Promise.all([loadService(serviceId), loadServices()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus judul");
    } finally {
      setBusy(false);
    }
  };

  // ── actions: command bash ─────────────────────────────────────────────────

  const submitCommand = async () => {
    const body = newBody.trim();
    if (!body || !titleId) return;
    setBusy(true);
    try {
      await api(`/titles/${titleId}/commands`, {
        method: "POST",
        body: { label: newLabel.trim(), body },
      });
      setNewLabel("");
      setNewBody("");
      setShowNewCommand(false);
      await Promise.all([loadTitle(titleId), loadService(serviceId), loadServices()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan command");
    } finally {
      setBusy(false);
    }
  };

  const saveCommand = async () => {
    if (!editCommand) return;
    const body = editCommand.body.trim();
    if (!body) return;
    setBusy(true);
    try {
      await api(`/entries/${editCommand.uuid}`, {
        method: "PATCH",
        body: { label: editCommand.label.trim(), body },
      });
      setEditCommand(null);
      await loadTitle(titleId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan command");
    } finally {
      setBusy(false);
    }
  };

  const removeCommand = async (cmd: BashCommand) => {
    if (!window.confirm(`Hapus command "${cmd.label || cmd.body.split("\n")[0]}"?`)) return;
    setBusy(true);
    try {
      await api(`/entries/${cmd.uuid}`, { method: "DELETE" });
      await Promise.all([loadTitle(titleId), loadService(serviceId), loadServices()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus command");
    } finally {
      setBusy(false);
    }
  };

  const copyCommand = async (cmd: BashCommand) => {
    try {
      await navigator.clipboard.writeText(cmd.body);
      setCopiedId(cmd.uuid);
      setTimeout(() => setCopiedId((cur) => (cur === cmd.uuid ? null : cur)), 1800);
    } catch {
      setError("Gagal menyalin ke clipboard");
    }
  };

  // ── render ────────────────────────────────────────────────────────────────

  const activeService = detail?.service ?? services.find((s) => s.uuid === serviceId) ?? null;
  const activeTitle =
    titleDetail?.title ??
    detail?.titles.find((t) => t.uuid === titleId) ??
    null;

  // Mobile: tampilkan satu panel saja sesuai kedalaman navigasi.
  const showServicesPanel = !serviceId;
  const showTitlesPanel = !!serviceId && !titleId;
  const showCommandsPanel = !!titleId;

  return (
    <div className="flex h-full w-full min-h-0 flex-col overflow-hidden bg-paper">
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-background/80 px-4 backdrop-blur-sm">
        <div className="flex min-w-0 items-center gap-2">
          <SquareTerminal className="h-4 w-4 shrink-0 text-gold-ink" />
          <span className="label-caps hidden sm:inline">Command Sets</span>
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={() => navigate({ service: "", title: "" })}
              className={cn(
                "cursor-pointer truncate transition-colors hover:text-ink",
                serviceId ? "text-muted" : "font-medium text-ink"
              )}
            >
              Services
            </button>
            {activeService && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
                <button
                  type="button"
                  onClick={() => navigate({ service: activeService.uuid, title: "" })}
                  className={cn(
                    "cursor-pointer truncate transition-colors hover:text-ink",
                    titleId ? "text-muted" : "font-medium text-ink"
                  )}
                >
                  {activeService.name}
                </button>
              </>
            )}
            {activeTitle && (
              <>
                <ChevronRight className="h-3 w-3 shrink-0 text-faint" />
                <span className="truncate font-medium text-ink">{activeTitle.title}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />}
          <button
            type="button"
            title="Muat ulang"
            className={iconBtn}
            onClick={() => {
              loadServices();
              if (serviceId) loadService(serviceId);
              if (titleId) loadTitle(titleId);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {/* ── Panels ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* 1. Services */}
        <Panel
          title="Services"
          count={services.length}
          className={cn(
            "border-line md:w-72 md:shrink-0 md:border-r",
            showServicesPanel ? "flex-1" : "hidden md:flex"
          )}
          actions={
            <button
              type="button"
              title="Service baru"
              className={iconBtn}
              onClick={() => setShowNewService((v) => !v)}
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          }
        >
          {showNewService && (
            <div className="space-y-2 border-b border-line bg-panel/60 p-3">
              <input
                autoFocus
                className={inputCls}
                placeholder="github, docker, hermes..."
                value={newService}
                onChange={(e) => setNewService(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submitService();
                  if (e.key === "Escape") setShowNewService(false);
                }}
              />
              <div className="flex gap-2">
                <button type="button" className={btnPrimary} disabled={busy || !newService.trim()} onClick={submitService}>
                  <Check className="h-3.5 w-3.5" /> Simpan
                </button>
                <button type="button" className={btnGhost} onClick={() => setShowNewService(false)}>
                  Batal
                </button>
              </div>
            </div>
          )}

          {loadingServices ? (
            <div className="flex items-center justify-center gap-2 p-6 font-mono text-xs text-muted">
              <Loader2 className="h-4 w-4 animate-spin text-gold" /> memuat…
            </div>
          ) : services.length === 0 ? (
            <EmptyState
              icon={<Layers className="h-5 w-5" />}
              title="Belum ada service"
              hint="Bikin service dulu (misal github, docker, hermes), lalu isi judul command dan command bash di dalamnya."
            />
          ) : (
            services.map((svc) => (
              <Row
                key={svc.uuid}
                active={svc.uuid === serviceId}
                onClick={() => navigate({ service: svc.uuid, title: "" })}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{svc.name}</div>
                  <div className="font-mono text-[10px] text-faint">
                    {svc.title_count} judul · {svc.command_count} command
                  </div>
                </div>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
              </Row>
            ))
          )}
        </Panel>

        {/* 2. Judul command */}
        <Panel
          title={activeService ? `Judul — ${activeService.name}` : "Judul command"}
          count={detail?.titles.length ?? 0}
          className={cn(
            "border-line md:w-80 md:shrink-0 md:border-r",
            showTitlesPanel ? "flex-1" : "hidden md:flex"
          )}
          actions={
            <>
              {serviceId && (
                <button
                  type="button"
                  title="Judul baru"
                  className={iconBtn}
                  onClick={() => setShowNewTitle((v) => !v)}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              )}
            </>
          }
        >
          {!serviceId ? (
            <EmptyState
              icon={<Layers className="h-5 w-5" />}
              title="Pilih service"
              hint="Pilih service di kiri buat lihat daftar judul command-nya."
            />
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 border-b border-line bg-panel/60 px-3 py-2">
                <button
                  type="button"
                  className={cn(btnGhost, "md:hidden")}
                  onClick={() => navigate({ service: "", title: "" })}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Services
                </button>
                {activeService && (
                  <div className="flex min-w-0 items-center gap-1 md:flex-1">
                    {editService ? (
                      <>
                        <input
                          className={inputCls}
                          value={editService.name}
                          onChange={(e) => setEditService({ name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveService();
                            if (e.key === "Escape") setEditService(null);
                          }}
                        />
                        <button type="button" className={iconBtn} title="Simpan" onClick={saveService}>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        </button>
                        <button type="button" className={iconBtn} title="Batal" onClick={() => setEditService(null)}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="truncate text-xs font-medium text-ink">{activeService.name}</span>
                        <button
                          type="button"
                          className={iconBtn}
                          title="Ganti nama service"
                          onClick={() => setEditService({ name: activeService.name })}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          title="Hapus service"
                          onClick={() => removeService(activeService)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {showNewTitle && (
                <div className="space-y-2 border-b border-line bg-panel/60 p-3">
                  <input
                    autoFocus
                    className={inputCls}
                    placeholder="Judul command, misal: PR workflow"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitTitle();
                      if (e.key === "Escape") setShowNewTitle(false);
                    }}
                  />
                  <div className="flex gap-2">
                    <button type="button" className={btnPrimary} disabled={busy || !newTitle.trim()} onClick={submitTitle}>
                      <Check className="h-3.5 w-3.5" /> Simpan
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setShowNewTitle(false)}>
                      Batal
                    </button>
                  </div>
                </div>
              )}

              {loadingDetail ? (
                <div className="flex items-center justify-center gap-2 p-6 font-mono text-xs text-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-gold" /> memuat…
                </div>
              ) : (detail?.titles.length ?? 0) === 0 ? (
                <EmptyState
                  icon={<Layers className="h-5 w-5" />}
                  title="Belum ada judul"
                  hint="Tambah judul command di service ini (misal: PR workflow, cleanup, deploy)."
                />
              ) : (
                detail?.titles.map((t) => (
                  <Row
                    key={t.uuid}
                    active={t.uuid === titleId}
                    onClick={() => navigate({ service: serviceId, title: t.uuid })}
                  >
                    {editTitle?.uuid === t.uuid ? (
                      <div className="flex w-full items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <input
                          autoFocus
                          className={inputCls}
                          value={editTitle.title}
                          onChange={(e) => setEditTitle({ uuid: t.uuid, title: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveTitle();
                            if (e.key === "Escape") setEditTitle(null);
                          }}
                        />
                        <button type="button" className={iconBtn} onClick={saveTitle} title="Simpan">
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        </button>
                        <button type="button" className={iconBtn} onClick={() => setEditTitle(null)} title="Batal">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-ink">{t.title}</div>
                          <div className="font-mono text-[10px] text-faint">{t.command_count} command</div>
                        </div>
                        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <span
                            role="button"
                            tabIndex={0}
                            className={iconBtn}
                            title="Ganti judul"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditTitle({ uuid: t.uuid, title: t.title });
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            className={iconBtn}
                            title="Hapus judul"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeTitle(t);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </span>
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" />
                      </>
                    )}
                  </Row>
                ))
              )}
            </>
          )}
        </Panel>

        {/* 3. Command bash */}
        <Panel
          title={activeTitle ? `Commands — ${activeTitle.title}` : "Commands"}
          count={titleDetail?.commands.length ?? 0}
          className={cn("min-w-0 flex-1", showCommandsPanel ? "flex" : "hidden md:flex")}
          actions={
            titleId ? (
              <button
                type="button"
                title="Command baru"
                className={iconBtn}
                onClick={() => setShowNewCommand((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            ) : null
          }
        >
          {!titleId ? (
            <EmptyState
              icon={<SquareTerminal className="h-5 w-5" />}
              title="Pilih judul command"
              hint="Pilih salah satu judul di tengah buat lihat dan nambah command bash-nya."
            />
          ) : (
            <div className="p-4">
              <button
                type="button"
                className={cn(btnGhost, "mb-3 md:hidden")}
                onClick={() => navigate({ service: serviceId, title: "" })}
              >
                <ArrowLeft className="h-3.5 w-3.5" /> {activeService?.name ?? "Judul"}
              </button>

              {showNewCommand && (
                <div className="mb-4 space-y-2 rounded-xl border border-line bg-panel/60 p-3">
                  <input
                    autoFocus
                    className={inputCls}
                    placeholder="Label, misal: Bikin PR draft"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                  />
                  <textarea
                    className={cn(inputCls, "min-h-24 font-mono text-[13px]")}
                    placeholder={"gh pr create --draft --fill"}
                    value={newBody}
                    onChange={(e) => setNewBody(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setShowNewCommand(false);
                    }}
                  />
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={btnPrimary}
                      disabled={busy || !newBody.trim()}
                      onClick={submitCommand}
                    >
                      <Check className="h-3.5 w-3.5" /> Simpan command
                    </button>
                    <button type="button" className={btnGhost} onClick={() => setShowNewCommand(false)}>
                      Batal
                    </button>
                  </div>
                </div>
              )}

              {loadingTitle ? (
                <div className="flex items-center justify-center gap-2 p-6 font-mono text-xs text-muted">
                  <Loader2 className="h-4 w-4 animate-spin text-gold" /> memuat…
                </div>
              ) : (titleDetail?.commands.length ?? 0) === 0 ? (
                <EmptyState
                  icon={<SquareTerminal className="h-5 w-5" />}
                  title="Belum ada command"
                  hint="Tambah command bash di judul ini. Satu command bisa multi-baris."
                />
              ) : (
                <div className="space-y-3">
                  {titleDetail?.commands.map((cmd) => (
                    <div key={cmd.uuid} className="overflow-hidden rounded-xl border border-line bg-card shadow-xs">
                      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                        {editCommand?.uuid === cmd.uuid ? (
                          <input
                            className={inputCls}
                            placeholder="Label"
                            value={editCommand.label}
                            onChange={(e) => setEditCommand({ ...editCommand, label: e.target.value })}
                          />
                        ) : (
                          <span className="truncate text-xs font-medium text-ink">
                            {cmd.label || <span className="text-faint">tanpa label</span>}
                          </span>
                        )}
                        <div className="flex shrink-0 items-center gap-1">
                          {editCommand?.uuid === cmd.uuid ? (
                            <>
                              <button type="button" className={iconBtn} title="Simpan" onClick={saveCommand}>
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              </button>
                              <button type="button" className={iconBtn} title="Batal" onClick={() => setEditCommand(null)}>
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                className={iconBtn}
                                title="Salin command"
                                onClick={() => copyCommand(cmd)}
                              >
                                {copiedId === cmd.uuid ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                className={iconBtn}
                                title="Edit command"
                                onClick={() =>
                                  setEditCommand({ uuid: cmd.uuid, label: cmd.label, body: cmd.body })
                                }
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                className={iconBtn}
                                title="Hapus command"
                                onClick={() => removeCommand(cmd)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {editCommand?.uuid === cmd.uuid ? (
                        <textarea
                          className={cn(inputCls, "min-h-28 rounded-none border-0 font-mono text-[13px] focus:ring-0")}
                          value={editCommand.body}
                          onChange={(e) => setEditCommand({ ...editCommand, body: e.target.value })}
                        />
                      ) : (
                        <pre className="overflow-x-auto px-3 py-3 font-mono text-[13px] leading-relaxed text-ink-soft">
                          <code>{cmd.body}</code>
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
