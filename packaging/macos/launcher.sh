#!/bin/bash
# Training Room.app — starts the bundled local server and opens the app in the default browser.
# Everything it needs is inside this .app bundle. If a server from an older Training Room is still
# running on the port (it stays up for a few hours after use), it is stopped first, so the browser
# always gets the files of THIS copy of the app. Training progress lives in the browser, not here.
RES="$(cd "$(dirname "$0")/../Resources" && pwd)"
URL="http://localhost:8765/"
ver() { /usr/bin/sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' | /usr/bin/head -1; }
WANT="$(ver < "$RES/site/precache.json")"
up() { /usr/bin/curl -s -o /dev/null --max-time 1 "$URL"; }
running() { /usr/bin/curl -s --max-time 2 "${URL}precache.json" | ver; }
if up && [ "$(running)" != "$WANT" ]; then
  # stop only the process listening on the port, and only if it is a Training Room server
  for PID in $(/usr/sbin/lsof -nP -t -iTCP:8765 -sTCP:LISTEN 2>/dev/null); do
    case "$(/bin/ps -o command= -p "$PID")" in *"/Contents/Resources/server-"*|*"/Contents/Resources/serve.pl"*) kill "$PID" ;; esac
  done
  for i in $(seq 1 25); do up || break; sleep 0.2; done
fi
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
if up && [ "$(running)" = "$WANT" ]; then /usr/bin/open "$URL"
elif up; then /usr/bin/osascript -e 'display alert "Another program is using port 8765." message "Training Room could not replace it. Restart the Mac and open Training Room again."' >/dev/null 2>&1
else /usr/bin/osascript -e 'display alert "Training Room could not start its local server." message "Another program may be using port 8765. Restart the Mac and try again."' >/dev/null 2>&1
fi
