#!/bin/zsh
# Compila o DrivePlay.app como binário universal (Intel + Apple Silicon).
set -euo pipefail
cd "$(dirname "$0")"

./build.sh

echo "→ Compilando as duas arquiteturas…"
swiftc -O -target arm64-apple-macos14.0 Sources/*.swift -o build/DrivePlay-arm64
swiftc -O -target x86_64-apple-macos14.0 Sources/*.swift -o build/DrivePlay-x86_64

echo "→ Juntando com lipo…"
lipo -create \
    -output build/DrivePlay.app/Contents/MacOS/DrivePlay \
    build/DrivePlay-arm64 \
    build/DrivePlay-x86_64

codesign --force --sign - build/DrivePlay.app >/dev/null 2>&1 || true

echo ""
echo "✅ App universal pronto: build/DrivePlay.app"
lipo -archs build/DrivePlay.app/Contents/MacOS/DrivePlay
