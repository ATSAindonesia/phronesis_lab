"use client";

import React from "react";
import { ChevronRight, Folder } from "lucide-react";
import { cn } from "@/lib/utils";

interface FileBreadcrumbsProps {
  selectedPath: string;
  onNavigateFolder: (folderPath: string) => void;
  onNavigateFile: (filePath: string) => void;
  onNavigateRoot: () => void;
}

export function FileBreadcrumbs({
  selectedPath,
  onNavigateFolder,
  onNavigateFile,
  onNavigateRoot,
}: FileBreadcrumbsProps) {
  if (!selectedPath) {
    return (
      <div className="flex items-center gap-1.5 text-xs font-mono text-faint">
        <span>repo</span>
        <span className="text-faint/60">/</span>
        <span className="italic">no file selected</span>
      </div>
    );
  }

  const parts = selectedPath.split("/");

  return (
    <nav
      aria-label="Breadcrumbs"
      className="flex items-center gap-1.5 text-xs font-mono text-muted min-w-0 flex-wrap"
    >
      <button
        type="button"
        onClick={onNavigateRoot}
        title="Go to root directory"
        className="text-faint hover:text-ink hover:underline cursor-pointer transition-colors shrink-0"
      >
        repo
      </button>

      <span className="text-faint/50 select-none shrink-0">/</span>

      {parts.map((part, idx) => {
        const isLast = idx === parts.length - 1;
        const currentSubPath = parts.slice(0, idx + 1).join("/");

        if (isLast) {
          return (
            <button
              key={currentSubPath}
              type="button"
              onClick={() => onNavigateFile(currentSubPath)}
              title={"Active file: " + currentSubPath}
              className="text-ink font-medium max-w-[200px] truncate hover:text-gold transition-colors cursor-pointer"
            >
              {part}
            </button>
          );
        }

        return (
          <React.Fragment key={currentSubPath}>
            <button
              type="button"
              onClick={() => onNavigateFolder(currentSubPath)}
              title={"Open directory: " + currentSubPath}
              className="hover:text-gold hover:underline text-muted transition-colors cursor-pointer max-w-[150px] truncate"
            >
              {part}
            </button>
            <span className="text-faint/50 select-none shrink-0">/</span>
          </React.Fragment>
        );
      })}
    </nav>
  );
}
