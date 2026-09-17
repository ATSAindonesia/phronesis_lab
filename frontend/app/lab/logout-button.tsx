"use client";

import { useRouter } from "next/navigation";

export default function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="rounded-lg border border-line-strong px-3.5 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-ink hover:text-paper cursor-pointer"
    >
      Log out
    </button>
  );
}
