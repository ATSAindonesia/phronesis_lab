#!/bin/bash
set -e
# /data is bind-mounted from the host. The backend runs as host uid (passed via
# BUILDER_UID, default 1000). In node:20-slim the user "node" already has uid
# 1000, so agent-written files and vite run as the same owner on both sides.
UID_N=${BUILDER_UID:-1000}
RUN_AS=$(getent passwd "$UID_N" | cut -d: -f1)
[ -z "$RUN_AS" ] && RUN_AS=node

mkdir -p /data/app
if [ ! -d /data/app/node_modules ]; then
  cp -a /opt/template/. /data/app/
  chown -R "$UID_N":"$UID_N" /data || true
fi
cd /data/app

# Dev server loop: auto-restart if vite crashes on a transient broken edit.
while true; do
  runuser -u "$RUN_AS" -- npx vite --host 0.0.0.0 --port 5173 || true
  sleep 2
done
