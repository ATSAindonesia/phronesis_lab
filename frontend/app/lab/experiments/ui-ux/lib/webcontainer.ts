// WebContainer singleton manager for client-side execution
import type { WebContainer as WebContainerType } from "@webcontainer/api";

let webcontainerInstance: WebContainerType | null = null;
let bootPromise: Promise<WebContainerType> | null = null;

export interface StarterFile {
  file: {
    contents: string;
  };
}

export interface StarterDirectory {
  directory: Record<string, StarterFile | StarterDirectory>;
}

export const starterFiles: Record<string, StarterFile | StarterDirectory> = {
  "package.json": {
    file: {
      contents: JSON.stringify(
        {
          name: "playground-app",
          private: true,
          version: "0.0.0",
          type: "module",
          scripts: {
            dev: "vite --host",
            build: "vite build",
            preview: "vite preview",
          },
          dependencies: {
            react: "^18.3.1",
            "react-dom": "^18.3.1",
            "lucide-react": "^0.468.0",
            clsx: "^2.1.1",
            "tailwind-merge": "^2.5.5",
          },
          devDependencies: {
            "@vitejs/plugin-react": "^4.3.4",
            vite: "^5.4.11",
          },
        },
        null,
        2
      ),
    },
  },
  "tailwind.config.js": {
    file: {
      contents: `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {},
  },
  plugins: [],
};`,
    },
  },
  "vite.config.js": {
    file: {
      contents: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});`,
    },
  },
  "index.html": {
    file: {
      contents: `<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UI/UX Playground</title>
    <!-- Standalone In-Browser Tailwind Engine (Served locally by Vite - 100% offline & immune to CORS/COEP) -->
    <script src="/tailwind.js"></script>
    <script>
      if (window.tailwind) {
        window.tailwind.config = {
          darkMode: 'class',
          theme: {
            extend: {},
          },
        };
      }
    </script>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        min-height: 100%;
        background-color: #09090b;
        color: #f4f4f5;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
    </style>
  </head>
  <body class="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
    },
  },
  src: {
    directory: {
      "main.tsx": {
        file: {
          contents: `import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);`,
        },
      },
      "styles.css": {
        file: {
          contents: `@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: system-ui, -apple-system, sans-serif;
}`,
        },
      },
      "App.tsx": {
        file: {
          contents: `import React from 'react';
import { Sparkles, Terminal, Cpu } from 'lucide-react';

export default function App() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 text-zinc-100 p-8 font-sans">
      <div className="max-w-md w-full rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-8 shadow-2xl backdrop-blur-xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400">
          <Sparkles className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-blue-400 via-indigo-300 to-violet-400 bg-clip-text text-transparent">
          Bolt.new Playground Ready
        </h1>
        <p className="mt-2 text-xs text-zinc-400 leading-relaxed">
          Powered by live WebContainer, Vite HMR, and real-time streaming AI coding actions.
        </p>
        <div className="mt-6 flex items-center justify-center gap-4 text-[11px] text-zinc-500">
          <span className="flex items-center gap-1"><Cpu className="h-3.5 w-3.5 text-emerald-400" /> Wasm Node.js</span>
          <span className="flex items-center gap-1"><Terminal className="h-3.5 w-3.5 text-blue-400" /> Vite HMR</span>
        </div>
      </div>
    </div>
  );
}`,
        },
      },
    },
  },
};

export function checkCrossOriginIsolation(): boolean {
  return typeof window !== "undefined" && window.crossOriginIsolated === true;
}

export async function getWebContainer(): Promise<WebContainerType> {
  if (webcontainerInstance) {
    return webcontainerInstance;
  }

  if (bootPromise) {
    return bootPromise;
  }

  bootPromise = (async () => {
    if (typeof window === "undefined") {
      throw new Error("WebContainer can only be initialized in the browser.");
    }

    if (!window.crossOriginIsolated) {
      throw new Error(
        "Cross-Origin Isolation is not active. WebContainer requires COOP (same-origin) and COEP (require-corp or credentialless)."
      );
    }

    let tailwindScript = "";
    try {
      const res = await fetch("/vendor/tailwind.js");
      if (res.ok) {
        tailwindScript = await res.text();
      }
    } catch {
      // Fallback if local fetch fails
    }

    const { WebContainer } = await import("@webcontainer/api");
    const container = await WebContainer.boot();

    // Mount starter files with the local in-browser Tailwind engine
    const mountFiles: Record<string, StarterFile | StarterDirectory> = { ...starterFiles };
    if (tailwindScript) {
      mountFiles["public"] = {
        directory: {
          "tailwind.js": {
            file: { contents: tailwindScript },
          },
        },
      };
      mountFiles["tailwind.js"] = {
        file: { contents: tailwindScript },
      };
    }

    await container.mount(mountFiles);

    webcontainerInstance = container;
    return container;
  })();

  return bootPromise;
}

export async function writeContainerFile(
  path: string,
  content: string
): Promise<void> {
  const container = await getWebContainer();
  // Ensure parent directory exists recursively (matching Bolt.new action-runner)
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash > 0) {
    const folder = path.substring(0, lastSlash).replace(/\/+$/g, "");
    if (folder && folder !== ".") {
      try {
        await container.fs.mkdir(folder, { recursive: true });
      } catch {
        // Directory may already exist
      }
    }
  }

  await container.fs.writeFile(path, content);
}

export async function readContainerFile(path: string): Promise<string> {
  const container = await getWebContainer();
  return await container.fs.readFile(path, "utf-8");
}

export async function spawnCommand(
  cmd: string,
  args: string[],
  onData: (chunk: string) => void
): Promise<number> {
  // Safeguard: Dev server is already persistent; skip redundant dev spawns that would block execution
  if ((cmd === "npm" && args.includes("dev")) || cmd === "vite") {
    onData("[Notice] Dev server is already active and running in background.\n");
    return 0;
  }

  const container = await getWebContainer();
  const proc = await container.spawn(cmd, args);

  proc.output.pipeTo(
    new WritableStream({
      write(data) {
        onData(data);
      },
    })
  );

  return proc.exit;
}
