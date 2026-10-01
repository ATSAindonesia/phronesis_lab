"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Settings as SettingsIcon,
  ShieldAlert,
  Trash2,
  User as UserIcon,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface LabUser {
  uuid: string;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api/users${path}`, {
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

function formatDate(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "—";
  return t.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" });
}

// ─── Style tokens (sama seperti commands) ────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-faint transition-colors focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/20";
const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-ink px-3 py-2 text-xs font-medium text-paper transition-colors hover:bg-ink-soft disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer";
const btnGhost =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium text-muted transition-colors hover:bg-accent hover:text-ink disabled:opacity-40 cursor-pointer";
const iconBtn =
  "rounded p-1.5 text-faint transition-colors hover:bg-accent hover:text-ink cursor-pointer";

// ─── Main page ───────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [users, setUsers] = useState<LabUser[]>([]);
  const [selfUuid, setSelfUuid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // form tambah
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");

  // edit inline
  const [edit, setEdit] = useState<{ uuid: string; name: string; email: string } | null>(null);
  // reset password
  const [reset, setReset] = useState<{ uuid: string; name: string; pw: string; pw2: string } | null>(null);

  const flashOk = (msg: string) => {
    setOkMsg(msg);
    setTimeout(() => setOkMsg((cur) => (cur === msg ? null : cur)), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, me] = await Promise.all([
        api<{ users: LabUser[] }>(""),
        api<{ user: LabUser }>("/me").catch(() => null),
      ]);
      setUsers(list.users ?? []);
      if (me) setSelfUuid(me.user.uuid);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memuat user");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data fetch on mount
    load();
  }, [load]);

  const submitNew = async () => {
    if (!newName.trim() || !newEmail.trim() || !newPassword) return;
    if (newPassword.length < 6) {
      setError("Password minimal 6 karakter");
      return;
    }
    if (newPassword !== newPassword2) {
      setError("Konfirmasi password tidak cocok");
      return;
    }
    setBusy(true);
    try {
      await api("", {
        method: "POST",
        body: { name: newName.trim(), email: newEmail.trim(), password: newPassword },
      });
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewPassword2("");
      setShowNew(false);
      await load();
      flashOk("User baru ditambahkan");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menambah user");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async () => {
    if (!edit || !edit.name.trim() || !edit.email.trim()) return;
    setBusy(true);
    try {
      await api(`/${edit.uuid}`, {
        method: "PATCH",
        body: { name: edit.name.trim(), email: edit.email.trim() },
      });
      setEdit(null);
      await load();
      flashOk("User diperbarui");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  const saveReset = async () => {
    if (!reset || !reset.pw) return;
    if (reset.pw.length < 6) {
      setError("Password minimal 6 karakter");
      return;
    }
    if (reset.pw !== reset.pw2) {
      setError("Konfirmasi password tidak cocok");
      return;
    }
    setBusy(true);
    try {
      await api(`/${reset.uuid}/password`, {
        method: "POST",
        body: { password: reset.pw },
      });
      setReset(null);
      flashOk(`Password ${reset.name} direset`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mereset password");
    } finally {
      setBusy(false);
    }
  };

  const removeUser = async (u: LabUser) => {
    const isSelf = u.uuid === selfUuid;
    if (isSelf) return;
    if (
      !window.confirm(
        `Hapus user "${u.name}" (${u.email})? Data commands & chat miliknya ikut terhapus permanen.`
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await api(`/${u.uuid}`, { method: "DELETE" });
      await load();
      flashOk("User dihapus");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus user");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6">
      {/* Header */}
      <section className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="label-caps flex items-center gap-1.5">
            <SettingsIcon className="h-3 w-3" />
            Phronesis Lab — Settings
          </span>
          <h1 className="font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
            Kelola <span className="text-faint">user.</span>
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Pendaftaran publik terkunci (single-user mode) — user baru hanya bisa
            ditambahkan di sini oleh sesi login.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />}
          <button
            type="button"
            title="Muat ulang"
            onClick={load}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card text-muted transition-colors hover:bg-accent hover:text-ink"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setShowNew((v) => !v)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-medium text-paper transition-colors hover:bg-ink-soft"
          >
            <Plus className="h-3.5 w-3.5" /> Tambah user
          </button>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 break-words">{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            className="cursor-pointer text-red-500 hover:text-red-700"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {okMsg && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{okMsg}</span>
        </div>
      )}

      {/* Form tambah */}
      {showNew && (
        <div className="hairline-card space-y-2.5 p-4">
          <span className="label-caps">User baru</span>
          <input
            autoFocus
            className={inputCls}
            placeholder="Nama lengkap"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className={inputCls}
            placeholder="email@example.com"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <input
              className={inputCls}
              placeholder="Password (min 6)"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <input
              className={inputCls}
              placeholder="Konfirmasi password"
              type="password"
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitNew();
                if (e.key === "Escape") setShowNew(false);
              }}
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={busy || !newName.trim() || !newEmail.trim() || !newPassword}
              onClick={submitNew}
            >
              <Check className="h-3.5 w-3.5" /> Simpan
            </button>
            <button type="button" className={btnGhost} onClick={() => setShowNew(false)}>
              Batal
            </button>
          </div>
        </div>
      )}

      {/* Daftar user */}
      <section className="hairline-card overflow-hidden">
        <div className="flex h-12 items-center justify-between border-b border-line px-4">
          <span className="label-caps">Users</span>
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-faint">
            {users.length}
          </span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 p-8 font-mono text-xs text-muted">
            <Loader2 className="h-4 w-4 animate-spin text-gold" /> memuat…
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <UserIcon className="h-5 w-5 text-faint" />
            <p className="text-xs text-muted">Belum ada user.</p>
          </div>
        ) : (
          users.map((u) => {
            const isSelf = u.uuid === selfUuid;
            return (
              <div
                key={u.uuid}
                className="border-b border-line/70 px-4 py-3 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel font-display text-sm font-medium text-ink">
                    {(u.name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    {edit?.uuid === u.uuid ? (
                      <div className="flex flex-col gap-1.5 sm:flex-row">
                        <input
                          autoFocus
                          className={inputCls}
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") setEdit(null);
                          }}
                        />
                        <input
                          className={inputCls}
                          value={edit.email}
                          onChange={(e) => setEdit({ ...edit, email: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") saveEdit();
                            if (e.key === "Escape") setEdit(null);
                          }}
                        />
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-ink">
                            {u.name}
                          </span>
                          {isSelf && (
                            <span className="shrink-0 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                              you
                            </span>
                          )}
                        </div>
                        <div className="truncate font-mono text-[11px] text-faint">
                          {u.email} · sejak {formatDate(u.created_at)}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {edit?.uuid === u.uuid ? (
                      <>
                        <button type="button" className={iconBtn} title="Simpan" onClick={saveEdit}>
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          title="Batal"
                          onClick={() => setEdit(null)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          className={iconBtn}
                          title="Edit nama & email"
                          onClick={() => {
                            setReset(null);
                            setEdit({ uuid: u.uuid, name: u.name, email: u.email });
                          }}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={iconBtn}
                          title="Reset password"
                          onClick={() => {
                            setEdit(null);
                            setReset({ uuid: u.uuid, name: u.name, pw: "", pw2: "" });
                          }}
                        >
                          <ShieldAlert className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={cn(iconBtn, isSelf && "cursor-not-allowed opacity-30 hover:bg-transparent hover:text-faint")}
                          title={isSelf ? "Tidak bisa menghapus akun sendiri" : "Hapus user"}
                          disabled={isSelf}
                          onClick={() => removeUser(u)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Panel reset password */}
                {reset?.uuid === u.uuid && (
                  <div className="mt-3 space-y-2 rounded-xl border border-line bg-panel/60 p-3">
                    <span className="label-caps">Reset password — {u.name}</span>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <input
                        autoFocus
                        type="password"
                        className={inputCls}
                        placeholder="Password baru (min 6)"
                        value={reset.pw}
                        onChange={(e) => setReset({ ...reset, pw: e.target.value })}
                      />
                      <input
                        type="password"
                        className={inputCls}
                        placeholder="Konfirmasi"
                        value={reset.pw2}
                        onChange={(e) => setReset({ ...reset, pw2: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveReset();
                          if (e.key === "Escape") setReset(null);
                        }}
                      />
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className={btnPrimary}
                        disabled={busy || !reset.pw}
                        onClick={saveReset}
                      >
                        <Check className="h-3.5 w-3.5" /> Simpan password
                      </button>
                      <button type="button" className={btnGhost} onClick={() => setReset(null)}>
                        Batal
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </section>

      <p className="font-mono text-[10px] leading-relaxed text-faint">
        Endpoint user CRUD hanya untuk sesi login. Menghapus user ikut menghapus
        data commands & chat miliknya. Akun sendiri dan user terakhir tidak bisa dihapus.
      </p>
    </div>
  );
}
