#!/bin/bash
# Training Room.app — starts the bundled local server (if it is not already running) and opens
# the app in the default browser. Everything it needs is inside this .app bundle.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
URL="http://localhost:8765/"
up() { /usr/bin/curl -s -o /dev/null --max-time 1 "$URL"; }
if ! up; then
  case "$(/usr/bin/uname -m)" in arm64) BIN="$RES/server-arm64" ;; *) BIN="$RES/server-x86_64" ;; esac
  /usr/bin/nohup "$BIN" "$RES/site" >/dev/null 2>&1 &
  for i in $(seq 1 25); do up && break; sleep 0.2; done
  # fallback: the macOS system Perl, if the native server could not start
  if ! up && [ -x /usr/bin/perl ]; then
    /usr/bin/nohup /usr/bin/perl "$RES/serve.pl" "$RES/site" >/dev/null 2>&1 &
    for i in $(seq 1 25); do up && break; sleep 0.2; done
  fi
fi
if up; then /usr/bin/open "$URL"
else /usr/bin/osascript -e 'display alert "Training Room could not start its local server." message "Another program may be using port 8765. Restart the Mac and try again."' >/dev/null 2>&1
fi
