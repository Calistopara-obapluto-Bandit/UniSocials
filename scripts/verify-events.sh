#!/usr/bin/env bash
set -euo pipefail
# Run this from project root. Prints the live preview root/events + /events.html status.
# Fallback to direct curl against the preview URL if preview tooling is unavailable.
if command -v freebuff-preview >/dev/null 2>&1; then
  echo '[preview] attempting curl against running preview (freebuff-preview status)' >&2
  URL="$(freebuff-preview status 2>/dev/null | grep -oE 'https?://[^ ]+' | head -n 1 || true)"
else
  URL=''
fi

if [ -z "$URL" ]; then
  echo '[preview] no preview URL available; skipping live preview check' >&2
  exit 0
fi

echo "[preview] base url: $URL" >&2
for p in '/events' '/events.html'; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "$URL$p")"
  printf '[preview] %s -> %s\n' "$p" "$code"
done