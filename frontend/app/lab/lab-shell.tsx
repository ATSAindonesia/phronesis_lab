"use client";

import React from "react";
import { usePathname } from "next/navigation";
import Header from "./header";

export default function LabShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isUiUxPage = pathname === "/lab/experiments/ui-ux";
  const isChatPage = pathname === "/lab/chat";

  if (isUiUxPage || isChatPage) {
    // Fullscreen pages (UI/UX experiment + chat):
    // The header is integrated directly as part of the page itself,
    // maximizing screen space.
    return (
      <div className="flex flex-1 flex-col overflow-hidden min-w-0 h-full w-full">
        {children}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Default Header for regular lab pages */}
      <Header title="Research & Development" subtitle="Lab Phronesis" />

      {/* Centered Content Container */}
      <main className="flex flex-1 items-center justify-center p-6 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
