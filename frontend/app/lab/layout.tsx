import React from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Sidebar from "./sidebar";
import LabShell from "./lab-shell";

export default async function LabLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const session = cookieStore.get("session");

  if (!session?.value) {
    redirect("/login");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-paper font-sans">
      {/* Sidebar */}
      <Sidebar />

      {/* Main Content Area with conditional header */}
      <LabShell>{children}</LabShell>
    </div>
  );
}

