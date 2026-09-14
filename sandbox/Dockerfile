FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git curl ca-certificates ripgrep \
    && rm -rf /var/lib/apt/lists/*

# Pre-warmed Vite React + Tailwind v4 template: npm install sekali di image.
RUN mkdir -p /opt/template && cd /opt/template \
    && npm create vite@latest app -- --template react >/dev/null 2>&1 \
    && cd app \
    && npm install --no-audit --no-fund >/dev/null 2>&1 \
    && npm install --no-audit --no-fund tailwindcss @tailwindcss/vite lucide-react clsx tailwind-merge >/dev/null 2>&1 \
    && mv /opt/template/app/* /opt/template/ && rm -rf /opt/template/app

RUN cat > /opt/template/vite.config.js <<'EOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// BASE_PATH: saat preview di-embed lewat path /b/{port}/ (domain via
// Cloudflare, port tidak bisa dipakai), vite harus serve di bawah base itu.
// HMR websocket ikut base; kalau proxy di depan tidak meneruskan WS upgrade,
// vite client cuma log error — UI me-refresh iframe tiap turn.
const base = process.env.BASE_PATH || '/'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    hmr: base === '/' ? true : { path: base },
  },
})
EOF

RUN echo '@import "tailwindcss";' > /opt/template/src/index.css \
    && rm -f /opt/template/src/App.css \
    && sed -i "s|from './App.jsx'|from './App'|" /opt/template/src/main.jsx \
    && rm -rf /opt/template/src/assets \
    && cat > /opt/template/src/App.jsx <<'APPX'
export default function App() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-stone-100 dark:bg-zinc-950">
      <div className="max-w-md rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight text-stone-900 dark:text-zinc-50">Design Lab Sandbox</h1>
        <p className="mt-2 text-sm text-stone-500 dark:text-zinc-400">Submit a prompt — the agent rebuilds this app live.</p>
      </div>
    </div>
  )
}
APPX

COPY entry.sh /entry.sh
RUN chmod +x /entry.sh

WORKDIR /workspace
CMD ["/entry.sh"]
