"use client";

import React, { useState, useEffect, useCallback } from "react";
import { transform } from "sucrase";
import {
  AlertCircle,
  RefreshCw,
  Code2,
  Terminal,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface ProjectFile {
  name: string;
  language: string;
  content: string;
}

interface ParsedError {
  file?: string;
  line?: number;
  column?: number;
  message: string;
  snippet?: string;
  raw: string;
}

interface SandboxPreviewProps {
  files: Record<string, ProjectFile>;
  className?: string;
  keyTrigger?: string | number;
  onSwitchToFile?: (fileName: string) => void;
  isGenerating?: boolean;
}

export default function SandboxPreview({
  files,
  className,
  keyTrigger,
  onSwitchToFile,
  isGenerating = false,
}: SandboxPreviewProps) {
  const [compileError, setCompileError] = useState<ParsedError | null>(null);
  const [iframeSrcDoc, setIframeSrcDoc] = useState<string>("");
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  const handleManualReload = useCallback(() => {
    setIsRefreshing(true);
    setIsLoading(true);
    setRefreshKey((k) => k + 1);
    const timer = setTimeout(() => setIsRefreshing(false), 600);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    try {
      setCompileError(null);
      setIsLoading(true);

      // Collect CSS
      let cssContent = "";
      for (const [path, file] of Object.entries(files)) {
        if (path.endsWith(".css") || file.language === "css") {
          cssContent += file.content + "\n";
        }
      }

      // Compile each JS/TS/JSX/TSX file with sucrase
      const compiledModules: { path: string; code: string }[] = [];

      for (const [path, file] of Object.entries(files)) {
        if (
          path.endsWith(".tsx") ||
          path.endsWith(".ts") ||
          path.endsWith(".jsx") ||
          path.endsWith(".js")
        ) {
          try {
            const compiled = transform(file.content, {
              transforms: ["typescript", "jsx", "imports"],
              production: true,
            });
            compiledModules.push({ path, code: compiled.code });
          } catch (err: unknown) {
            const rawMsg = err instanceof Error ? err.message : String(err);
            // Parse line / column from error message
            const lineColMatch = rawMsg.match(/(?:at\s+)?(?:\(?(\d+):(\d+)\)?)/);
            const line = lineColMatch ? parseInt(lineColMatch[1], 10) : undefined;
            const column = lineColMatch ? parseInt(lineColMatch[2], 10) : undefined;

            let snippet = "";
            if (line && file.content) {
              const lines = file.content.split("\n");
              const start = Math.max(0, line - 2);
              const end = Math.min(lines.length, line + 1);
              snippet = lines
                .slice(start, end)
                .map((l, idx) => {
                  const lineNum = start + idx + 1;
                  const isTarget = lineNum === line;
                  return `${isTarget ? "> " : "  "}${lineNum.toString().padStart(3, " ")} | ${l}`;
                })
                .join("\n");
            }

            setCompileError({
              file: path,
              line,
              column,
              message: rawMsg.replace(/\s*\(\d+:\d+\)/, "").replace(/^SyntaxError:\s*/, ""),
              snippet,
              raw: rawMsg,
            });
            setIsLoading(false);
            return;
          }
        }
      }

      // Check if entry point exists (e.g. src/App or App)
      const hasApp = Object.keys(files).some(
        (p) => p.includes("App.tsx") || p.includes("App.jsx") || p.includes("App.js")
      );

      if (!hasApp && compiledModules.length === 0) {
        setCompileError({
          message: "No React entry component found. Expected src/App.tsx",
          raw: "Entry point missing",
        });
        setIsLoading(false);
        return;
      }

      // Generate module registry code
      let modulesRegisterCode = "";
      for (const mod of compiledModules) {
        modulesRegisterCode += `
          defineModule("${mod.path}", function(module, exports, require) {
            ${mod.code}
          });
        `;
      }

      // Build complete isolated HTML document for the iframe
      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
  <style>
    /* Injected Project CSS */
    ${cssContent}
    html, body {
      min-height: 100%;
      margin: 0;
      padding: 0;
      background: transparent;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    }
  </style>
</head>
<body class="bg-transparent text-slate-100">
  <div id="root"></div>

  <script>
    function renderRuntimeError(title, message, stack) {
      const root = document.getElementById('root');
      if (!root) return;
      root.innerHTML = \`
        <div style="min-height: 80vh; display: flex; align-items: center; justify-content: center; padding: 24px; box-sizing: border-box;">
          <div style="max-width: 520px; width: 100%; background: #09090b; border: 1px solid rgba(244, 63, 94, 0.3); border-radius: 16px; padding: 24px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); font-family: ui-sans-serif, system-ui, sans-serif; color: #f4f4f5;">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
              <div style="width: 28px; height: 28px; border-radius: 8px; background: rgba(244, 63, 94, 0.15); display: flex; align-items: center; justify-content: center; color: #f43f5e; font-size: 13px; font-weight: bold;">✕</div>
              <div>
                <h4 style="margin: 0; font-size: 13px; font-weight: 700; color: #ffffff;">\${title}</h4>
                <p style="margin: 0; font-size: 11px; color: #71717a;">Runtime error in React component tree</p>
              </div>
            </div>
            <div style="background: rgba(244, 63, 94, 0.08); border-left: 3px solid #f43f5e; padding: 10px 12px; border-radius: 6px; font-size: 12px; color: #fca5a5; font-family: ui-monospace, monospace; margin-bottom: 12px; word-break: break-word;">
              \${message}
            </div>
            \${stack ? \`<details style="margin-bottom: 14px;"><summary style="font-size: 11px; color: #71717a; cursor: pointer; user-select: none;">View Call Stack</summary><pre style="margin-top: 8px; font-size: 10px; font-family: ui-monospace, monospace; color: #a1a1aa; max-height: 140px; overflow: auto; background: #18181b; padding: 10px; border-radius: 8px; white-space: pre-wrap;">\${stack}</pre></details>\` : ''}
            <div style="display: flex; justify-content: flex-end;">
              <button onclick="window.location.reload()" style="background: #27272a; color: #e4e4e7; border: 1px solid #3f3f46; padding: 6px 14px; border-radius: 8px; font-size: 11px; font-weight: 600; cursor: pointer;">
                Reload Sandbox
              </button>
            </div>
          </div>
        </div>
      \`;
    }

    window.addEventListener('error', function(e) {
      renderRuntimeError('Runtime Exception', e.message || 'Unknown runtime error', e.error && e.error.stack ? e.error.stack : '');
    });

    const modules = {};
    const moduleCache = {};

    function defineModule(name, fn) {
      modules[name] = fn;
    }

    function resolvePath(baseDir, rel) {
      if (!rel.startsWith('.')) return rel;
      const parts = (baseDir ? baseDir + '/' + rel : rel).split('/').filter(Boolean);
      const res = [];
      for (const p of parts) {
        if (p === '.') continue;
        if (p === '..') res.pop();
        else res.push(p);
      }
      return res.join('/');
    }

    function customRequire(fromFile, modulePath) {
      if (modulePath === 'react') return window.React;
      if (modulePath === 'react-dom' || modulePath === 'react-dom/client') return window.ReactDOM;

      // Mock lucide-react if imported by generated code
      if (modulePath === 'lucide-react') {
        return new Proxy({}, {
          get: (target, prop) => {
            return (props) => window.React.createElement('svg', {
              width: props.size || 16,
              height: props.size || 16,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              className: props.className,
              style: props.style,
            }, window.React.createElement('circle', { cx: 12, cy: 12, r: 8 }));
          }
        });
      }

      // Mock or support recharts if imported
      if (modulePath === 'recharts') {
        const dummyComp = (props) => window.React.createElement('div', {
          className: (props.className || '') + ' w-full h-full min-h-[160px] flex items-center justify-center bg-slate-800/40 rounded-xl border border-slate-700/50 p-4 text-xs text-slate-300',
          style: props.style
        }, props.children || window.React.createElement('span', null, '📊 Chart Visualization'));
        return new Proxy({}, {
          get: () => dummyComp
        });
      }

      // Mock or support framer-motion if imported
      if (modulePath === 'framer-motion') {
        const motionPropsToFilter = new Set([
          'initial', 'animate', 'exit', 'transition', 'variants',
          'whileHover', 'whileTap', 'whileFocus', 'whileDrag', 'whileInView',
          'layout', 'layoutId', 'layoutDependency', 'onAnimationComplete',
          'viewport'
        ]);

        const motion = new Proxy({}, {
          get: (target, tag) => {
            if (typeof tag !== 'string') return target[tag];
            return window.React.forwardRef((props, ref) => {
              const cleanProps = {};
              for (const [key, value] of Object.entries(props || {})) {
                if (!motionPropsToFilter.has(key)) {
                  cleanProps[key] = value;
                }
              }
              cleanProps.ref = ref;
              return window.React.createElement(tag, cleanProps);
            });
          }
        });

        return {
          motion,
          AnimatePresence: ({ children }) => window.React.createElement(window.React.Fragment, null, children),
          useAnimation: () => ({ start: () => Promise.resolve(), stop: () => {}, set: () => {} }),
          useMotionValue: (initial) => ({ get: () => initial, set: () => {}, onChange: () => () => {} }),
          useTransform: (value, input, output) => ({ get: () => (output ? output[0] : 0) }),
          useSpring: (value) => value,
          useScroll: () => ({ scrollY: { get: () => 0 }, scrollYProgress: { get: () => 0 } }),
          useInView: () => true,
        };
      }

      // Mock canvas-confetti if imported
      if (modulePath === 'canvas-confetti') {
        return () => Promise.resolve();
      }

      // Helper utilities
      if (modulePath === 'clsx' || modulePath === 'tailwind-merge') {
        return (...args) => args.flat().filter(Boolean).join(' ');
      }

      let resolved = modulePath;
      if (modulePath.startsWith('@/')) {
        resolved = 'src/' + modulePath.slice(2);
      } else if (modulePath.startsWith('.')) {
        const baseDir = fromFile.includes('/') ? fromFile.substring(0, fromFile.lastIndexOf('/')) : '';
        resolved = resolvePath(baseDir, modulePath);
      }

      const candidates = [
        resolved,
        'src/' + resolved,
        resolved + '.tsx',
        resolved + '.ts',
        resolved + '.jsx',
        resolved + '.js',
        'src/' + resolved + '.tsx',
        resolved + '/index.tsx',
        resolved + '/index.js'
      ];

      for (const cand of candidates) {
        if (modules[cand]) {
          if (!moduleCache[cand]) {
            const mod = { exports: {} };
            modules[cand](mod, mod.exports, (p) => customRequire(cand, p));
            moduleCache[cand] = mod.exports;
          }
          return moduleCache[cand];
        }
      }

      throw new Error('Module not found: ' + modulePath + ' (from: ' + fromFile + ')');
    }

    // Register Modules
    ${modulesRegisterCode}

    // Mount Root App
    try {
      let AppExport;
      if (modules['src/App.tsx']) AppExport = customRequire('src', 'src/App.tsx');
      else if (modules['src/App.jsx']) AppExport = customRequire('src', 'src/App.jsx');
      else if (modules['Component.tsx']) AppExport = customRequire('', 'Component.tsx');
      else {
        const first = Object.keys(modules)[0];
        AppExport = customRequire('', first);
      }

      const RootComponent = (AppExport && (AppExport.default || AppExport)) || AppExport;

      if (typeof RootComponent === 'function' || typeof RootComponent === 'object') {
        const rootElem = document.getElementById('root');
        if (window.ReactDOM.createRoot) {
          const root = window.ReactDOM.createRoot(rootElem);
          root.render(window.React.createElement(RootComponent));
        } else {
          window.ReactDOM.render(window.React.createElement(RootComponent), rootElem);
        }
      } else {
        throw new Error('Default export from App.tsx is not a valid React component');
      }
    } catch(err) {
      renderRuntimeError('Component Render Error', err.message || 'Render failed', err.stack || '');
    }
  </script>
</body>
</html>`;

      setIframeSrcDoc(html);
    } catch (e: unknown) {
      const rawMsg = e instanceof Error ? e.message : String(e);
      setCompileError({
        message: rawMsg,
        raw: rawMsg,
      });
      setIsLoading(false);
    }
  }, [files, keyTrigger, refreshKey]);

  return (
    <div className={`relative flex h-full w-full flex-col overflow-hidden ${className || ""}`}>
      {/* Sandbox Top Status / Refresh Bar */}
      <div className="flex h-8 items-center justify-between border-b border-zinc-200/80 bg-zinc-50/80 px-3 text-[11px] text-zinc-500 backdrop-blur-xs dark:border-zinc-800/80 dark:bg-zinc-950/60 shrink-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "h-2 w-2 rounded-full transition-all duration-300",
              compileError
                ? "bg-rose-500 ring-4 ring-rose-500/20"
                : isLoading || isGenerating
                ? "bg-amber-400 ring-4 ring-amber-400/20 animate-pulse"
                : "bg-emerald-500 ring-4 ring-emerald-500/20"
            )}
          />
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {compileError
              ? "Sandbox Error"
              : isLoading || isGenerating
              ? "Syncing runtime..."
              : "Live React Runtime"}
          </span>
          <span className="hidden sm:inline-block rounded-md bg-zinc-200/60 px-1.5 py-0.5 text-[9px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            v18.3
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleManualReload}
            disabled={isRefreshing}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer",
              isRefreshing
                ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                : "text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            )}
            title="Reload Sandbox Preview"
          >
            <RefreshCw
              className={cn("h-3 w-3 transition-transform", isRefreshing && "animate-spin text-blue-500")}
            />
            <span>{isRefreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* Main Sandbox Area */}
      <div className="relative flex-1 h-full w-full overflow-hidden bg-transparent">
        {/* Loading Overlay */}
        {isLoading && !compileError && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-zinc-950/20 backdrop-blur-[1.5px] transition-all duration-300 pointer-events-none">
            <div className="flex items-center gap-2.5 rounded-2xl border border-zinc-200/80 bg-white/95 px-4 py-2.5 text-xs font-medium text-zinc-700 shadow-xl backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-200">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-blue-500/30 border-t-blue-500" />
              <span>Mounting sandbox preview...</span>
            </div>
          </div>
        )}

        {/* Compiler Error Overlay */}
        {compileError ? (
          <div className="flex h-full w-full items-center justify-center p-4 sm:p-8 overflow-auto bg-zinc-950/40 backdrop-blur-xs">
            <div className="w-full max-w-lg rounded-2xl border border-rose-500/30 bg-zinc-950/95 p-5 sm:p-6 shadow-2xl backdrop-blur-xl text-zinc-100 animate-in fade-in zoom-in-95 duration-200">
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-zinc-800/80 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/25 shrink-0">
                    <AlertCircle className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400">
                        Compilation Error
                      </h4>
                      {compileError.line && (
                        <span className="rounded-md bg-rose-500/15 px-1.5 py-0.2 text-[10px] font-semibold text-rose-300 border border-rose-500/20">
                          Line {compileError.line}
                          {compileError.column ? `:${compileError.column}` : ""}
                        </span>
                      )}
                    </div>
                    {compileError.file && (
                      <p className="mt-0.5 text-xs font-mono text-zinc-400">
                        {compileError.file}
                      </p>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleManualReload}
                  className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors cursor-pointer"
                  title="Try Recompiling"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Error Message */}
              <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-mono text-rose-200 leading-relaxed break-words">
                {compileError.message}
              </div>

              {/* Code Snippet with Line Highlight if available */}
              {compileError.snippet && (
                <div className="mt-3 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/90 font-mono text-[11px]">
                  <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5 text-[10px] text-zinc-500 bg-zinc-950/60">
                    <span className="flex items-center gap-1.5">
                      <Terminal className="h-3 w-3 text-zinc-400" />
                      Code Snippet
                    </span>
                    <span>{compileError.file}</span>
                  </div>
                  <pre className="p-3 text-zinc-300 overflow-x-auto leading-5 selection:bg-rose-500/30">
                    {compileError.snippet}
                  </pre>
                </div>
              )}

              {/* Actions */}
              <div className="mt-5 flex items-center justify-between pt-2">
                <span className="text-[11px] text-zinc-500">
                  Fix syntax in Code view to live-refresh
                </span>

                <div className="flex items-center gap-2">
                  {compileError.file && onSwitchToFile && (
                    <button
                      type="button"
                      onClick={() => onSwitchToFile(compileError.file!)}
                      className="flex items-center gap-1.5 rounded-xl border border-zinc-700 bg-zinc-800/90 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 transition-colors cursor-pointer shadow-xs"
                    >
                      <Code2 className="h-3.5 w-3.5 text-blue-400" />
                      <span>Edit File</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleManualReload}
                    className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:from-blue-500 hover:to-indigo-500 transition-all cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" />
                    <span>Retry</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Sandbox Iframe */
          <iframe
            key={refreshKey}
            srcDoc={iframeSrcDoc}
            title="Live Component Sandbox"
            sandbox="allow-scripts allow-modals allow-same-origin"
            onLoad={() => setIsLoading(false)}
            className="h-full w-full border-0 bg-transparent"
          />
        )}
      </div>
    </div>
  );
}
