"use client";

import React, { useCallback, useEffect, useState, useMemo } from "react";
import {
  Folder,
  FolderOpen,
  FileCode,
  ChevronRight,
  ChevronDown,
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

// ─── Types ──────────────────────────────────────────────────────────────────

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

interface TreeResponse {
  path: string;
  entries: FileEntry[];
}

interface ContentResponse {
  path: string;
  name: string;
  language: string;
  size: number;
  content: string;
}

interface ApiError {
  code: string;
  message: string;
}

interface TreeNode {
  entry: FileEntry;
  depth: number;
  isOpen: boolean;
  isLoading: boolean;
  children?: TreeNode[];
  isLoaded: boolean;
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export default function FilesPage() {
  // Tree state
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [isTreeLoading, setIsTreeLoading] = useState<boolean>(true);
  const [treeError, setTreeError] = useState<ApiError | null>(null);

  // Active File state
  const [selectedPath, setSelectedPath] = useState<string>("");
  const [activeFile, setActiveFile] = useState<ContentResponse | null>(null);
  const [isFileLoading, setIsFileLoading] = useState<boolean>(false);
  const [fileError, setFileError] = useState<ApiError | null>(null);

  // UI state
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);

  // Fetch root tree
  const loadRootTree = useCallback(async () => {
    setIsTreeLoading(true);
    setTreeError(null);
    try {
      const res = await fetch("/api/files/tree");
      const json = await res.json();
      if (!res.ok) {
        setTreeError(json.error || { code: "HTTP_" + res.status, message: "Failed to fetch root directory" });
        setTreeData([]);
      } else {
        const entries: FileEntry[] = json.entries || [];
        // Sort: directories first, then alphabetically
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

  useEffect(() => {
    loadRootTree();
  }, [loadRootTree]);

  // Expand / collapse folder
  const toggleFolder = async (nodePath: string) => {
    const updateNode = (nodes: TreeNode[]): TreeNode[] => {
      return nodes.map((node) => {
        if (node.entry.path === nodePath) {
          return { ...node, isOpen: !node.isOpen };
        }
        if (node.children) {
          return { ...node, children: updateNode(node.children) };
        }
        return node;
      });
    };

    const findNode = (nodes: TreeNode[]): TreeNode | null => {
      for (const n of nodes) {
        if (n.entry.path === nodePath) return n;
        if (n.children) {
          const found = findNode(n.children);
          if (found) return found;
        }
      }
      return null;
    };

    const targetNode = findNode(treeData);
    if (!targetNode) return;

    if (targetNode.isOpen) {
      // Collapse
      setTreeData((prev) => updateNode(prev));
      return;
    }

    // Expanding: if already loaded, just toggle
    if (targetNode.isLoaded) {
      setTreeData((prev) => updateNode(prev));
      return;
    }

    // Set loading
    setTreeData((prev) => {
      const setNodeLoading = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map((n) => {
          if (n.entry.path === nodePath) {
            return { ...n, isLoading: true, error: undefined };
          }
          if (n.children) {
            return { ...n, children: setNodeLoading(n.children) };
          }
          return n;
        });
      };
      return setNodeLoading(prev);
    });

    try {
      const res = await fetch(`/api/files/tree?path=${encodeURIComponent(nodePath)}`);
      const json = await res.json();

      setTreeData((prev) => {
        const injectChildren = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map((n) => {
            if (n.entry.path === nodePath) {
              if (!res.ok) {
                return {
                  ...n,
                  isLoading: false,
                  isOpen: true,
                  error: json.error?.message || "Failed to load directory",
                };
              }
              const rawEntries: FileEntry[] = json.entries || [];
              rawEntries.sort((a, b) => {
                if (a.type === b.type) return a.name.localeCompare(b.name);
                return a.type === "directory" ? -1 : 1;
              });

              const children: TreeNode[] = rawEntries.map((e) => ({
                entry: e,
                depth: n.depth + 1,
                isOpen: false,
                isLoading: false,
                isLoaded: false,
              }));

              return {
                ...n,
                isOpen: true,
                isLoading: false,
                isLoaded: true,
                children,
              };
            }
            if (n.children) {
              return { ...n, children: injectChildren(n.children) };
            }
            return n;
          });
        };
        return injectChildren(prev);
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Network error";
      setTreeData((prev) => {
        const setError = (nodes: TreeNode[]): TreeNode[] => {
          return nodes.map((n) => {
            if (n.entry.path === nodePath) {
              return { ...n, isLoading: false, isOpen: true, error: message };
            }
            if (n.children) {
              return { ...n, children: setError(n.children) };
            }
            return n;
          });
        };
        return setError(prev);
      });
    }
  };

  // Load file content
  const selectFile = async (filePath: string) => {
    if (selectedPath === filePath && activeFile) return;
    setSelectedPath(filePath);
    setIsFileLoading(true);
    setFileError(null);

    try {
      const res = await fetch(`/api/files/content?path=${encodeURIComponent(filePath)}`);
      const json = await res.json();
      if (!res.ok) {
        setFileError(json.error || { code: "HTTP_" + res.status, message: "Failed to fetch file content" });
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
  };

  // Copy content helper
  const handleCopy = () => {
    if (!activeFile?.content) return;
    navigator.clipboard.writeText(activeFile.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Memoized tokenized lines for performance
  const tokenizedLines = useMemo(() => {
    if (!activeFile?.content) return [];
    const lines = activeFile.content.split("\n");
    const lang = activeFile.language || "plaintext";
    return lines.map((line) => highlightLine(line, lang));
  }, [activeFile]);

  // Recursive Tree Node Renderer
  const renderNode = (node: TreeNode) => {
    const isDir = node.entry.type === "directory";
    const isSelected = selectedPath === node.entry.path;

    return (
      <div key={node.entry.path} className="flex flex-col select-none">
        <button
          type="button"
          onClick={() => {
            if (isDir) {
              toggleFolder(node.entry.path);
            } else {
              selectFile(node.entry.path);
            }
          }}
          style={{ paddingLeft: `${node.depth * 14 + 10}px` }}
          className={cn(
            "group flex items-center gap-2 py-1.5 pr-3 rounded-md text-[13px] font-mono transition-colors text-left w-full cursor-pointer",
            isSelected
              ? "bg-ink text-paper font-medium"
              : "text-muted hover:bg-accent hover:text-ink"
          )}
        >
          {isDir ? (
            <span className="flex items-center gap-1.5 shrink-0">
              {node.isLoading ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-gold" />
              ) : node.isOpen ? (
                <ChevronDown className="h-3.5 w-3.5 text-faint group-hover:text-ink" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 text-faint group-hover:text-ink" />
              )}
              {node.isOpen ? (
                <FolderOpen className="h-4 w-4 text-gold shrink-0" />
              ) : (
                <Folder className="h-4 w-4 text-gold shrink-0" />
              )}
            </span>
          ) : (
            <span className="flex items-center gap-1.5 shrink-0 pl-4">
              <FileCode className={cn("h-4 w-4 shrink-0", isSelected ? "text-gold" : "text-faint group-hover:text-ink")} />
            </span>
          )}

          <span className="truncate flex-1 tracking-tight">{node.entry.name}</span>
        </button>

        {/* Directory error */}
        {isDir && node.isOpen && node.error && (
          <div
            style={{ paddingLeft: `${(node.depth + 1) * 14 + 10}px` }}
            className="text-[11px] text-red-500 py-1 flex items-center gap-1.5 font-mono"
          >
            <AlertCircle className="h-3 w-3 shrink-0" />
            <span className="truncate">{node.error}</span>
          </div>
        )}

        {/* Children */}
        {isDir && node.isOpen && node.children && (
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
    <div className="flex h-[calc(100vh-4rem)] flex-col md:flex-row bg-background overflow-hidden">
      {/* ─── Tree Sidebar ─────────────────────────────────────────────────── */}
      <div
        className={cn(
          "border-r border-line bg-panel flex flex-col transition-all duration-200 shrink-0",
          isSidebarOpen ? "w-full md:w-80 h-72 md:h-full" : "h-auto md:h-full md:w-0 overflow-hidden border-r-0"
        )}
      >
        {/* Tree Header */}
        <div className="h-12 border-b border-line px-4 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="label-caps">Repository Explorer</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={loadRootTree}
              disabled={isTreeLoading}
              title="Refresh tree"
              className="p-1.5 rounded text-faint hover:text-ink hover:bg-accent transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isTreeLoading && "animate-spin")} />
            </button>
          </div>
        </div>

        {/* Tree Content */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {isTreeLoading && treeData.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-muted text-[13px] font-mono gap-2">
              <RefreshCw className="h-4 w-4 animate-spin text-gold" />
              <span>Scanning files...</span>
            </div>
          ) : treeError ? (
            <div className="p-4 rounded-md bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900/30 text-red-600 dark:text-red-400 space-y-1">
              <div className="flex items-center gap-2 font-mono text-xs font-semibold">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>[{treeError.code}]</span>
              </div>
              <p className="text-xs font-mono break-words">{treeError.message}</p>
              <button
                onClick={loadRootTree}
                className="mt-2 px-2.5 py-1 bg-ink text-paper rounded text-xs font-mono cursor-pointer hover:bg-ink-soft transition-colors"
              >
                Retry
              </button>
            </div>
          ) : treeData.length === 0 ? (
            <div className="p-6 text-center text-faint text-xs font-mono">
              No files found in root directory.
            </div>
          ) : (
            treeData.map((node) => renderNode(node))
          )}
        </div>
      </div>

      {/* ─── Code Viewer / Main Area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 bg-paper overflow-hidden">
        {/* Top Breadcrumb & Metadata Bar */}
        <div className="h-12 border-b border-line px-4 flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-sm">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              title={isSidebarOpen ? "Collapse Explorer" : "Expand Explorer"}
              className="p-1.5 rounded text-faint hover:text-ink hover:bg-accent transition-colors cursor-pointer shrink-0"
            >
              {isSidebarOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>

            {/* Breadcrumbs */}
            {selectedPath ? (
              <div className="flex items-center gap-1.5 text-xs font-mono text-muted min-w-0 truncate">
                <span className="text-faint">repo /</span>
                {selectedPath.split("/").map((part, idx, arr) => (
                  <React.Fragment key={idx}>
                    <span className={cn(idx === arr.length - 1 ? "text-ink font-medium" : "text-muted")}>
                      {part}
                    </span>
                    {idx < arr.length - 1 && <span className="text-faint">/</span>}
                  </React.Fragment>
                ))}
              </div>
            ) : (
              <span className="text-xs font-mono text-faint">Select a file to inspect</span>
            )}
          </div>

          {/* Right Action / Metadata */}
          {activeFile && (
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-2 font-mono text-[11px] text-faint">
                <span className="px-2 py-0.5 rounded border border-line bg-panel text-muted uppercase font-medium">
                  {activeFile.language}
                </span>
                <span className="hidden sm:inline-block">{formatFileSize(activeFile.size)}</span>
              </div>
              <button
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
        <div className="flex-1 overflow-auto p-4">
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
                <p className="text-xs leading-relaxed break-words">{fileError.message}</p>
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
                            <span key={tIdx} className={getTokenClassName(tok.type)}>
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
                <h3 className="font-display font-medium text-ink text-sm">No file selected</h3>
                <p className="text-xs text-muted max-w-sm">
                  Navigate the repository directory tree on the left and select any file to inspect its code.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
