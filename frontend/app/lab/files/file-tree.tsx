"use client";

import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  Folder,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertCircle,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TreeNode, FileEntry } from "./types";

interface FileTreeProps {
  treeData: TreeNode[];
  isLoading: boolean;
  error: { code: string; message: string } | null;
  selectedPath: string;
  focusedPath: string;
  onSetFocusedPath: (path: string) => void;
  onSelectFile: (filePath: string) => void;
  onToggleFolder: (folderPath: string) => void;
  onRetryRoot: () => void;
}

interface FlattenedItem {
  node: TreeNode;
  isDir: boolean;
  path: string;
  name: string;
  depth: number;
  isOpen: boolean;
  hasChildren: boolean;
  parentPath?: string;
}

export function FileTree({
  treeData,
  isLoading,
  error,
  selectedPath,
  focusedPath,
  onSetFocusedPath,
  onSelectFile,
  onToggleFolder,
  onRetryRoot,
}: FileTreeProps) {
  const [filterQuery, setFilterQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const activeNodeRef = useRef<HTMLButtonElement | null>(null);

  const trimmedQuery = filterQuery.trim().toLowerCase();

  // Helper to count total matching nodes in loaded tree
  const matchStats = useMemo(() => {
    if (!trimmedQuery) return { count: 0, active: false };

    let count = 0;
    function scan(nodes: TreeNode[]) {
      for (const node of nodes) {
        if (node.entry.name.toLowerCase().includes(trimmedQuery)) {
          count++;
        }
        if (node.children) {
          scan(node.children);
        }
      }
    }
    scan(treeData);
    return { count, active: true };
  }, [treeData, trimmedQuery]);

  // Determine if a node matches or has descendants matching filter
  const filterPredicate = useCallback(
    (node: TreeNode): { matchesSelf: boolean; matchesSubtree: boolean } => {
      if (!trimmedQuery) {
        return { matchesSelf: true, matchesSubtree: true };
      }

      const matchesSelf = node.entry.name.toLowerCase().includes(trimmedQuery);
      let childMatches = false;

      if (node.children) {
        for (const child of node.children) {
          const res = filterPredicate(child);
          if (res.matchesSelf || res.matchesSubtree) {
            childMatches = true;
            break;
          }
        }
      }

      return {
        matchesSelf,
        matchesSubtree: matchesSelf || childMatches,
      };
    },
    [trimmedQuery]
  );

  // Flatten currently visible nodes for keyboard navigation
  const visibleItems = useMemo(() => {
    const items: FlattenedItem[] = [];

    function traverse(nodes: TreeNode[], parentPath?: string) {
      for (const node of nodes) {
        const { matchesSelf, matchesSubtree } = filterPredicate(node);
        if (trimmedQuery && !matchesSubtree) continue;

        const isDir = node.entry.type === "directory";
        const isOpen = trimmedQuery ? true : node.isOpen;

        items.push({
          node,
          isDir,
          path: node.entry.path,
          name: node.entry.name,
          depth: node.depth,
          isOpen,
          hasChildren: Boolean(node.children && node.children.length > 0),
          parentPath,
        });

        if (isDir && isOpen && node.children) {
          traverse(node.children, node.entry.path);
        }
      }
    }

    traverse(treeData);
    return items;
  }, [treeData, trimmedQuery, filterPredicate]);

  // Handle keyboard events in tree
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (visibleItems.length === 0) return;

    // Ignore if focus is inside search input
    if ((e.target as HTMLElement)?.tagName === "INPUT") {
      if (e.key === "Escape") {
        setFilterQuery("");
        containerRef.current?.focus();
        e.preventDefault();
      }
      return;
    }

    const currentIndex = visibleItems.findIndex((item) => item.path === focusedPath);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const nextIndex = currentIndex < visibleItems.length - 1 ? currentIndex + 1 : 0;
        const nextItem = visibleItems[nextIndex];
        if (nextItem) {
          onSetFocusedPath(nextItem.path);
        }
        break;
      }

      case "ArrowUp": {
        e.preventDefault();
        const prevIndex = currentIndex > 0 ? currentIndex - 1 : visibleItems.length - 1;
        const prevItem = visibleItems[prevIndex];
        if (prevItem) {
          onSetFocusedPath(prevItem.path);
        }
        break;
      }

      case "ArrowRight": {
        e.preventDefault();
        const currentItem = visibleItems[currentIndex];
        if (!currentItem) return;

        if (currentItem.isDir) {
          if (!currentItem.isOpen) {
            onToggleFolder(currentItem.path);
          } else if (currentIndex + 1 < visibleItems.length) {
            const nextItem = visibleItems[currentIndex + 1];
            if (nextItem && nextItem.parentPath === currentItem.path) {
              onSetFocusedPath(nextItem.path);
            }
          }
        }
        break;
      }

      case "ArrowLeft": {
        e.preventDefault();
        const currentItem = visibleItems[currentIndex];
        if (!currentItem) return;

        if (currentItem.isDir && currentItem.isOpen) {
          onToggleFolder(currentItem.path);
        } else if (currentItem.parentPath) {
          onSetFocusedPath(currentItem.parentPath);
        }
        break;
      }

      case "Enter":
      case " ": {
        e.preventDefault();
        const currentItem = visibleItems[currentIndex];
        if (!currentItem) return;

        if (currentItem.isDir) {
          onToggleFolder(currentItem.path);
        } else {
          onSelectFile(currentItem.path);
        }
        break;
      }

      case "Home": {
        e.preventDefault();
        if (visibleItems.length > 0) {
          onSetFocusedPath(visibleItems[0].path);
        }
        break;
      }

      case "End": {
        e.preventDefault();
        if (visibleItems.length > 0) {
          onSetFocusedPath(visibleItems[visibleItems.length - 1].path);
        }
        break;
      }
    }
  };

  // Scroll active or focused item into view whenever path or treeData changes
  useEffect(() => {
    const targetPath = focusedPath || selectedPath;
    if (!targetPath) return;

    const timer = setTimeout(() => {
      const el = document.getElementById("tree-item-" + encodeURIComponent(targetPath));
      if (el) {
        el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
      }
    }, 40);

    return () => clearTimeout(timer);
  }, [focusedPath, selectedPath, treeData]);

  // Render a node recursively
  const renderNode = (node: TreeNode) => {
    const { matchesSelf, matchesSubtree } = filterPredicate(node);
    if (trimmedQuery && !matchesSubtree) return null;

    const isDir = node.entry.type === "directory";
    const isSelected = selectedPath === node.entry.path;
    const isFocused = focusedPath === node.entry.path;
    const isOpen = trimmedQuery ? true : node.isOpen;

    // Check if this directory is an ancestor of the currently selected file
    const isAncestorOfActive =
      isDir && selectedPath.startsWith(node.entry.path + "/");

    return (
      <div key={node.entry.path} className="flex flex-col select-none">
        <button
          id={"tree-item-" + encodeURIComponent(node.entry.path)}
          type="button"
          ref={isSelected ? activeNodeRef : undefined}
          onClick={() => {
            onSetFocusedPath(node.entry.path);
            if (isDir) {
              onToggleFolder(node.entry.path);
            } else {
              onSelectFile(node.entry.path);
            }
          }}
          style={{ paddingLeft: `${node.depth * 14 + 10}px` }}
          className={cn(
            "group flex items-center gap-2 py-1.5 pr-3 rounded-md text-[13px] font-mono transition-all duration-150 text-left w-full cursor-pointer relative",
            isSelected
              ? "bg-ink text-paper font-medium shadow-xs"
              : isAncestorOfActive
              ? "bg-accent/40 text-ink font-medium border-l-2 border-gold/70"
              : "text-muted hover:bg-accent hover:text-ink",
            isFocused && !isSelected && "ring-1 ring-gold/60 bg-accent/20"
          )}
        >
          {isDir ? (
            <span className="flex items-center gap-1.5 shrink-0">
              {node.isLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-gold" />
              ) : isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-faint group-hover:text-ink transition-transform" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-faint group-hover:text-ink transition-transform" />
              )}
              {isOpen ? (
                <FolderOpen
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isAncestorOfActive ? "text-gold-ink" : "text-gold"
                  )}
                />
              ) : (
                <Folder
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isAncestorOfActive ? "text-gold-ink" : "text-gold"
                  )}
                />
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 shrink-0 pl-4">
              <FileCode
                className={cn(
                  "h-4 w-4 shrink-0 transition-colors",
                  isSelected
                    ? "text-gold"
                    : matchesSelf && trimmedQuery
                    ? "text-gold-ink"
                    : "text-faint group-hover:text-ink"
                )}
              />
            </span>
          )}

          <span
            className={cn(
              "truncate flex-1 tracking-tight",
              matchesSelf && trimmedQuery && !isSelected && "text-gold-ink font-semibold"
            )}
          >
            {node.entry.name}
          </span>

          {isAncestorOfActive && !isSelected && (
            <span
              title="Contains currently open file"
              className="h-1.5 w-1.5 rounded-full bg-gold shrink-0 opacity-80"
            />
          )}
        </button>

        {/* Directory error */}
        {isDir && isOpen && node.error && (
          <div
            style={{ paddingLeft: `${(node.depth + 1) * 14 + 10}px` }}
            className="text-[11px] text-red-600 dark:text-red-400 py-1 flex items-center gap-1.5 font-mono"
          >
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{node.error}</span>
          </div>
        )}

        {/* Directory Children */}
        {isDir && isOpen && node.children && (
          <div className="flex flex-col">
            {node.children.length === 0 && !node.isLoading && (
              <div
                style={{ paddingLeft: `${(node.depth + 1) * 14 + 10}px` }}
                className="text-[12px] text-faint py-1 font-mono italic"
              >
                (empty folder)
              </div>
            )}
            {node.children.map((child) => renderNode(child))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search / Filter Header */}
      <div className="p-2 border-b border-line bg-panel/70 shrink-0">
        <div className="relative flex items-center">
          <Search className="absolute left-2.5 h-3.5 w-3.5 text-faint pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder="Filter loaded files..."
            aria-label="Filter loaded files"
            className="w-full h-8 pl-8 pr-7 rounded-md border border-line bg-card text-xs font-mono text-ink placeholder:text-faint focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              title="Clear filter"
              className="absolute right-2 p-0.5 rounded text-faint hover:text-ink hover:bg-accent transition-colors cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Filter Results Info */}
        {matchStats.active && (
          <div className="flex items-center justify-between mt-1.5 px-1 text-[11px] font-mono text-muted">
            <span>
              {matchStats.count} {matchStats.count === 1 ? "match" : "matches"}
            </span>
            {matchStats.count > 0 && (
              <span className="text-[10px] text-faint">auto-expanded</span>
            )}
          </div>
        )}
      </div>

      {/* Tree Content Area */}
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        role="tree"
        aria-label="File repository tree"
        className="flex-1 overflow-y-auto p-2 space-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/40 focus-visible:ring-inset"
      >
        {isLoading && treeData.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted text-[13px] font-mono gap-2">
            <RefreshCw className="h-4 w-4 animate-spin text-gold" />
            <span>Scanning files...</span>
          </div>
        ) : error ? (
          <div className="p-4 rounded-md bg-red-50/80 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 space-y-1">
            <div className="flex items-center gap-2 font-mono text-xs font-semibold">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>[{error.code}]</span>
            </div>
            <p className="text-xs font-mono break-words">{error.message}</p>
            <button
              type="button"
              onClick={onRetryRoot}
              className="mt-2 px-2.5 py-1 bg-ink text-paper rounded text-xs font-mono cursor-pointer hover:bg-ink-soft transition-colors"
            >
              Retry
            </button>
          </div>
        ) : treeData.length === 0 ? (
          <div className="p-6 text-center text-faint text-xs font-mono">
            No files found in root directory.
          </div>
        ) : matchStats.active && matchStats.count === 0 ? (
          <div className="p-6 text-center text-muted text-xs font-mono space-y-2">
            <div>No matching loaded nodes for &ldquo;{filterQuery}&rdquo;</div>
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              className="px-2 py-1 rounded bg-accent text-[11px] hover:bg-accent/80 text-ink cursor-pointer"
            >
              Clear filter
            </button>
          </div>
        ) : (
          treeData.map((node) => renderNode(node))
        )}
      </div>
    </div>
  );
}
