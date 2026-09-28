"use client";

// Error boundary /lab/chat: kalau ada client-side exception yang lolos,
// tampilkan UI rapi di dalam layout lab — jangan sampai seluruh page
// digantikan error page generik Next ("This page couldn't load").
import { CircleAlert } from "lucide-react";

export default function ChatError({ reset }: { reset: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-[#F5DABF] p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center border border-red-200 bg-red-50 text-red-500">
        <CircleAlert className="h-6 w-6" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold text-[#0F3D3A]">
          Chat-nya ketiduran
        </h2>
        <p className="max-w-sm text-xs leading-relaxed text-[#0F3D3A]/70">
          Ada error tak terduga di halaman ini. Percakapanmu tetap aman di
          database — coba lagi.
        </p>
      </div>
      <button
        onClick={reset}
        className="bg-[#0F3D3A] px-4 py-2 text-xs font-medium text-[#F5DABF] transition hover:bg-[#0F3D3A]/85 active:scale-95"
      >
        Coba lagi
      </button>
    </div>
  );
}
