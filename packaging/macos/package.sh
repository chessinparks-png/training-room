#!/bin/bash
# Builds dist/Training-Room-macOS.zip: Training Room.app (bundled site + local server) and a README.
# The site copy uses the same exclusions as the Pages deploy: no raw/, tools/, PGNs or repo files.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"; PK="$REPO/packaging/macos"; OUT="$REPO/dist"; WORK="$(mktemp -d)"
APP="$WORK/Training Room/Training Room.app"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/site"
(cd "$REPO" && tar --exclude=./.git --exclude=./.github --exclude=./raw --exclude=./tools --exclude=./packaging --exclude=./dist \
  --exclude='*.pgn' --exclude=./README.md --exclude=./.gitignore -cf - .) | tar -xf - -C "$APP/Contents/Resources/site"
(cd "$PK" && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o "$APP/Contents/Resources/server-arm64" . \
          && CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "$APP/Contents/Resources/server-x86_64" .)
cp "$PK/launcher.sh" "$APP/Contents/MacOS/Training Room"; cp "$PK/serve.pl" "$APP/Contents/Resources/serve.pl"; cp "$PK/Info.plist" "$APP/Contents/Info.plist"
printf 'APPL????' > "$APP/Contents/PkgInfo"
python3 - "$REPO/assets/icons/icon-512.png" "$APP/Contents/Resources/AppIcon.icns" <<'PY'
import sys, struct
png = open(sys.argv[1], 'rb').read(); entry = b'ic09' + struct.pack('>I', 8 + len(png)) + png   # 512×512 PNG
open(sys.argv[2], 'wb').write(b'icns' + struct.pack('>I', 8 + len(entry)) + entry)
PY
chmod 755 "$APP/Contents/MacOS/Training Room" "$APP/Contents/Resources/server-arm64" "$APP/Contents/Resources/server-x86_64" "$APP/Contents/Resources/serve.pl"
cp "$PK/README.txt" "$WORK/Training Room/README.txt"
if find "$WORK" -name '*.pgn' | grep -q . || [ -e "$APP/Contents/Resources/site/raw" ]; then echo "private sources leaked into the package" >&2; exit 1; fi
mkdir -p "$OUT"; rm -f "$OUT/Training-Room-macOS.zip"; (cd "$WORK" && zip -qry -X "$OUT/Training-Room-macOS.zip" "Training Room")
rm -rf "$WORK"; echo "$OUT/Training-Room-macOS.zip"
