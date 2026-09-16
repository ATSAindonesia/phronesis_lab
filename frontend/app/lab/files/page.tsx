"use client";

import React, { useCallback, useEffect, useState, useMemo, useRef } from "react";
import {
  RefreshCw,
  AlertCircle,
  FileText,
  Copy,
  Check,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { highlightLine, getTokenClassName } from "./highlight";
import { FileEntry, ContentResponse, ApiError, TreeNode } from "./types";
import { parseUrlState, updateUrlState } from "./use-file-url-state";
import { FileBreadcrumbs } from "./file-breadcrumbs";
import { FileTree } from "./file-tree";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function findNode(nodes: TreeNode[], targetPath: string): TreeNode | null {
  for (const node of nodes) {
    if (node.entry.path === targetPath) return node;
    if (node.children) {
      const found = findNode(node.children, targetPath);
      if (found) return found;
    }
  }
  return null;
}

function setNodeOpen(nodes: TreeNode[], dirPath: string, isOpen: boolean): TreeNode[] {
  return nodes.map((node) => {
    if (node.entry.path === dirPath) {
      return { ...node, isOpen };
    }
    if (node.children) {
      return { ...node, children: setNodeOpen(node.children, dirPath, isOpen) };
    }
    return node;
  });
}

function syncTreeOpenState(nodes: TreeNode[], openPathsSet: Set<string>): TreeNode[] {
  return nodes.map((node) => {
    if (node.entry.type === "directory") {
      const shouldBeOpen = openPathsSet.has(node.entry.path);
      return {
        ...node,
        isOpen: shouldBeOpen,
        children: node.children ? syncTreeOpenState(node.children, openPathsSet) : undefined,
      };
    }
    return node;
  });
}

function setNodeLoading(nodes: TreeNode[], dirPath: string, isLoading: boolean): TreeNode[] {
  return nodes.map((node) => {
    if (node.entry.path === dirPath) {
      return { ...node, isLoading, error: undefined };
    }
    if (node.children) {
      return { ...node, children: setNodeLoading(node.children, dirPath, isLoading) };
    }
    return node;
  });
}

function setNodeError(nodes: TreeNode[], dirPath: string, error: string): TreeNode[] {
  return nodes.map((node) => {
    if (node.entry.path === dirPath) {
      return { ...node, isLoading: false, isOpen: true, error };
    }
    if (node.children) {
      return { ...node, children: setNodeError(node.children, dirPath, error) };
    }
    return node;
  });
}

function injectChildren(nodes: TreeNode[], dirPath: string, entries: FileEntry[]): TreeNode[] {
  return nodes.map((node) => {
    if (node.entry.path === dirPath) {
      const existingChildrenMap = new Map(
        (node.children || []).map((c) => [c.entry.path, c])
      );
      const newChildren: TreeNode[] = entries.map((e) => {
        const existing = existingChildrenMap.get(e.path);
        if (existing) return existing;
        return {
          entry: e,
          depth: node.depth + 1,
          isOpen: false,
          isLoading: false,
          isLoaded: false,
        };
      });
      return {
        ...node,
        isOpen: true,
        isLoading: false,
        isLoaded: true,
        children: newChildren,
      };
    }
    if (node.children) {
      return {
        ...node,
        children: injectChildren(node.children, dirPath, entries),
      };
    }
    return node;
  });
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function FilesPage() {
  // Tree state
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [isTreeLoading, setIsTreeLoading] = useState<boolean>(true);
  const [treeError, setTreeError] = useState<ApiError | null>(null);

  // Active file and navigation state
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [focusedPath, setFocusedPath] = useState<string>("");
  const [activeFile, setActiveFile] = useState<ContentResponse | null>(null);
  const [isFileLoading, setIsFileLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<ApiError | null>(null);

  // UI state
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // Refs to avoid stale closures in callbacks & listeners
  const openDirsRef = useRef<Set<string>>(new Set());
  const selectedPathRef = useRef<string>("");
  const viewerContainerRef = useRef<HTMLDivElement>(null);

  // Load root tree
  const loadRootTree = useCallback(async (): Promise<void> => {
    setIsTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch("/api/files/tree");
      const json = await res.json();
      if (!res.ok) {
        setTreeError(
          json.error || {
            code: "HTTP_" + res.status,
            message: "Failed to fetch root directory",
          }
        );
        setTreeData([]);
      } else {
        const entries: FileEntry[] = json.entries || [];
        entries.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "directory" ? -1 : 1;
        });

        setTreeData(
          entries.map((entry) => ({
            entry,
            depth: 0,
            isOpen: false,
            isLoading: false,
            isLoaded: false,
          }))
        );
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setTreeError({ code: "NETWORK_ERROR", message });
    } finally {
      setIsTreeLoading(false);
    }
  }, []);

  // Expand a list of directories in sequence down hierarchy
  const expandPaths = useCallback(async (pathsToExpand: string[]) => {
    if (!pathsToExpand || pathsToExpand.length === 0) return;

    const sorted = Array.from(new Set(pathsToExpand))
      .filter(Boolean)
      .sort((a, b) => a.split("/").length - b.split("/").length);

    for (const dirPath of sorted) {
      try {
        const res = await fetch(
          `/api/files/tree?path=${encodeURIComponent(dirPath)}`
        );
        if (!res.ok) continue;
        const json = await res.json();
        const entries: FileEntry[] = json.entries || [];
        entries.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "directory" ? -1 : 1;
        });
        setTreeData((prev) => injectChildren(prev, dirPath, entries));
      } catch {
        // Silently skip if subpath fails to fetch
      }
    }
  }, []);

  // Toggle single folder
  const toggleFolder = useCallback(
    async (folderPath: string) => {
      let isCurrentlyOpen = false;
      let isCurrentlyLoaded = false;

      setTreeData((prev) => {
        const node = findNode(prev, folderPath);
        if (node) {
          isCurrentlyOpen = node.isOpen;
          isCurrentlyLoaded = node.isLoaded;
          if (node.isOpen) {
            return setNodeOpen(prev, folderPath, false);
          } else if (node.isLoaded) {
            return setNodeOpen(prev, folderPath, true);
          } else {
            return setNodeLoading(prev, folderPath, true);
          }
        }
        return prev;
      });

      const nextOpenDirs = new Set(openDirsRef.current);
      if (isCurrentlyOpen) {
        nextOpenDirs.delete(folderPath);
        openDirsRef.current = nextOpenDirs;
        updateUrlState(
          selectedPathRef.current,
          Array.from(nextOpenDirs),
          "replace"
        );
        return;
      }

      nextOpenDirs.add(folderPath);
      openDirsRef.current = nextOpenDirs;
      updateUrlState(
        selectedPathRef.current,
        Array.from(nextOpenDirs),
        "replace"
      );

      if (isCurrentlyLoaded) return;

      try {
        const res = await fetch(
          `/api/files/tree?path=${encodeURIComponent(folderPath)}`
        );
        const json = await res.json();
        if (!res.ok) {
          setTreeData((prev) =>
            setNodeError(
              prev,
              folderPath,
              json.error?.message || "Failed to load directory"
            )
          );
          return;
        }
        const rawEntries: FileEntry[] = json.entries || [];
        rawEntries.sort((a, b) => {
          if (a.type === b.type) return a.name.localeCompare(b.name);
          return a.type === "directory" ? -1 : 1;
        });
        setTreeData((prev) => injectChildren(prev, folderPath, rawEntries));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Network error";
        setTreeData((prev) => setNodeError(prev, folderPath, message));
      }
    },
    []
  );

  // Load content of a specific file
  const selectFile = useCallback(
    async (filePath: string, pushHistory = true) => {
      if (!filePath) {
        setSelectedPath("");
        selectedPathRef.current = "";
        setActiveFile(null);
        if (pushHistory) {
          updateUrlState("", Array.from(openDirsRef.current), "push");
        }
        return;
      }

      // Collect ancestor directories to auto-expand
      const parts = filePath.split("/");
      const nextOpenDirs = new Set(openDirsRef.current);
      let acc = "";
      const ancestors: string[] = [];
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        nextOpenDirs.add(acc);
        ancestors.push(acc);
      }
      openDirsRef.current = nextOpenDirs;

      setSelectedPath(filePath);
      selectedPathRef.current = filePath;
      setFocusedPath(filePath);

      if (pushHistory) {
        updateUrlState(filePath, Array.from(nextOpenDirs), "push");
      }

      // Expand ancestors in tree so node is mounted and visible
      expandPaths(ancestors);

      setIsFileLoading(true);
      setFileError(null);

      try {
        const res = await fetch(
          `/api/files/content?path=${encodeURIComponent(filePath)}`
        );
        const json = await res.json();
        if (!res.ok) {
          setFileError(
            json.error || {
              code: "HTTP_" + res.status,
              message: "Failed to fetch file content",
            }
          );
          setActiveFile(null);
        } else {
          setActiveFile(json);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Network error";
        setFileError({ code: "NETWORK_ERROR", message });
        setActiveFile(null);
      } finally {
        setIsFileLoading(false);
      }
    },
    [expandPaths]
  );

  // Reset viewer scroll to top when activeFile changes
  useEffect(() => {
    if (activeFile && viewerContainerRef.current) {
      viewerContainerRef.current.scrollTop = 0;
      viewerContainerRef.current.scrollLeft = 0;
    }
  }, [activeFile?.path]);

  // Mount initialization: parse URL state, trigger content fetch, load root tree & expand
  useEffect(() => {
    const { file, openDirs: initialOpen } = parseUrlState();
    selectedPathRef.current = file;
    setSelectedPath(file);
    setFocusedPath(file);

    const initialOpenSet = new Set(initialOpen);
    openDirsRef.current = initialOpenSet;

    if (file) {
      selectFile(file, false);
    }

    loadRootTree().then(() => {
      if (initialOpen.length > 0) {
        expandPaths(initialOpen);
      }
    });
  }, [loadRootTree, selectFile, expandPaths]);

  // Popstate listener: restore exact state on browser Back / Forward
  useEffect(() => {
    const handlePopState = () => {
      const { file, openDirs: poppedOpenDirs } = parseUrlState();
      selectedPathRef.current = file;
      setSelectedPath(file);
      setFocusedPath(file);

      const nextOpen = new Set(poppedOpenDirs);
      openDirsRef.current = nextOpen;

      // Sync tree open/closed states for already loaded nodes
      setTreeData((prev) => syncTreeOpenState(prev, nextOpen));

      if (file) {
        selectFile(file, false);
      } else {
        setActiveFile(null);
        setFileError(null);
      }

      // Expand any directories that need lazy loading
      expandPaths(poppedOpenDirs);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [selectFile, expandPaths]);

  // Copy content helper
  const handleCopy = () => {
    if (!activeFile?.content) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Breadcrumb folder click handler
  const handleBreadcrumbFolderClick = useCallback(
    (folderPath: string) => {
      // Ensure all ancestors up to this folder are opened
      const parts = folderPath.split("/");
      const nextOpenDirs = new Set(openDirsRef.current);
      let acc = "";
      const ancestors: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        nextOpenDirs.add(acc);
        ancestors.push(acc);
      }
      openDirsRef.current = nextOpenDirs;

      setFocusedPath(folderPath);
      updateUrlState(
        selectedPathRef.current,
        Array.from(nextOpenDirs),
        "push"
      );
      expandPaths(ancestors);
    },
    [expandPaths]
  );

  // Breadcrumb root click handler
  const handleBreadcrumbRootClick = useCallback(() => {
    selectFile("", true);
  }, [selectFile]);

  // Tokenized lines for viewer
  const tokenizedLines = useMemo(() => {
    if (!activeFile?.content) return [];
    const lines = activeFile.content.split("\n");
    const lang = activeFile.language || "plaintext";
    return lines.map((line) => highlightLine(line, lang));
  }, [activeFile]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col md:flex-row bg-background overflow-hidden">
      {/* ─── Tree Sidebar ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          "border-r border-line bg-panel flex flex-col transition-all duration-200 shrink-0",
          isSidebarOpen
            ? "w-full md:w-80 h-80 md:h-full"
            : "h-auto md:h-full md:w-0 overflow-hidden border-r-0"
        )}
      >
        {/* Tree Top Bar */}
        <div className="h-12 border-b border-line px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="label-caps">Repository Explorer</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={loadRootTree}
              disabled={isTreeLoading}
              title="Refresh tree"
              className="p-1.5 rounded text-faint hover:text-ink hover:bg-accent transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isTreeLoading && "animate-spin")}
              />
            </button>
          </div>
        </div>

        {/* Tree Component (Search + Tree list + Keyboard Navigation) */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <FileTree
            treeData={treeData}
            isLoading={isTreeLoading}
            error={treeError}
            selectedPath={selectedPath}
            focusedPath={focusedPath}
            onSetFocusedPath={setFocusedPath}
            onSelectFile={(path) => selectFile(path, true)}
            onToggleFolder={toggleFolder}
            onRetryRoot={loadRootTree}
          />
        </div>
      </div>

      {/* ─── Code Viewer / Main Area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-paper overflow-hidden">
        {/* Top Breadcrumb & Metadata Bar */}
        <div className="h-12 border-b border-line px-4 flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-sm gap-2">
          <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
            <button
              type="button"
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title={isSidebarOpen ? "Collapse Explorer" : "Expand Explorer"}
              className="p-1.5 rounded text-faint hover:text-ink hover:bg-accent transition-colors cursor-pointer shrink-0"
            >
              {isSidebarOpen ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeftOpen className="h-4 w-4" />
              )}
            </button>

            {/* Clickable Breadcrumbs */}
            <div className="min-w-0 flex-1 overflow-x-auto py-1">
              <FileBreadcrumbs
                selectedPath={selectedPath}
                onNavigateFolder={handleBreadcrumbFolderClick}
                onNavigateFile={(path) => selectFile(path, true)}
                onNavigateRoot={handleBreadcrumbRootClick}
              />
            </div>
          </div>

          {/* Right Action / Metadata */}
          {activeFile && (
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
                <span className="px-2 py-0.5 rounded border border-line bg-panel text-muted uppercase font-medium">
                  {activeFile.language}
                </span>
                <span className="hidden sm:inline-block">
                  {formatFileSize(activeFile.size)}
                </span>
              </div>
              <button
                type="button"
                onClick={handleCopy}
                title="Copy file content"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-line bg-card hover:bg-accent text-muted hover:text-ink text-xs font-mono transition-colors cursor-pointer"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                    <span className="text-emerald-600">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Copy</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Main Content Area */}
        <div ref={viewerContainerRef} className="flex-1 overflow-auto p-4">
          {isFileLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-muted space-y-2 font-mono text-sm">
              <RefreshCw className="h-6 w-6 animate-spin text-gold" />
              <span>Loading file content...</span>
            </div>
          ) : fileError ? (
            <div className="flex items-center justify-center h-full p-4">
              <div className="max-w-md w-full p-6 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 space-y-3 font-mono">
                <div className="flex items-center gap-2 font-semibold text-sm">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <span>Error: {fileError.code}</span>
                </div>
                <p className="text-xs leading-relaxed break-words">
                  {fileError.message}
                </p>
                <div className="text-[11px] text-neutral-500">
                  Path: <span className="text-ink underline">{selectedPath}</span>
                </div>
              </div>
            </div>
          ) : activeFile ? (
            <div className="rounded-lg border border-line bg-card overflow-hidden shadow-xs">
              <pre className="p-4 font-mono text-[13px] leading-relaxed overflow-x-auto selection:bg-gold/30">
                <code>
                  {tokenizedLines.map((lineTokens, lineIdx) => (
                    <div key={lineIdx} className="table-row hover:bg-accent/40">
                      <span className="table-cell pr-5 select-none text-right text-faint text-[11px] w-10 font-mono">
                        {lineIdx + 1}
                      </span>
                      <span className="table-cell whitespace-pre">
                        {lineTokens.length === 0 ? (
                          "\n"
                        ) : (
                          lineTokens.map((tok, tIdx) => (
                            <span
                              key={tIdx}
                              className={getTokenClassName(tok.type)}
                            >
                              {tok.text}
                            </span>
                          ))
                        )}
                      </span>
                    </div>
                  ))}
                </code>
              </pre>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-8 space-y-3">
              <div className="h-12 w-12 rounded-full border border-line bg-panel flex items-center justify-center text-faint">
                <FileText className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display font-medium text-ink text-sm">
                  No file selected
                </h3>
                <p className="text-xs text-muted max-w-sm">
                  Navigate the repository directory tree on the left and select
                  any file to inspect its code.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
