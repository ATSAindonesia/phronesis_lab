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

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: true, port: 5173, strictPort: true },
})
EOF

RUN echo '@import "tailwindcss";' > /opt/template/src/index.css \
    && rm -f /opt/template/src/App.css /opt/template/src/App.jsx \
    && sed -i "s|from './App.jsx'|from './App'|" /opt/template/src/main.jsx \
    && rm -rf /opt/template/src/assets

COPY entry.sh /entry.sh
RUN chmod +x /entry.sh

WORKDIR /workspace
CMD ["/entry.sh"]
