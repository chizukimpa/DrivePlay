#!/bin/sh
# Baixa os binários do ffmpeg usados pelo player nativo.
# Uso: ./scripts/fetch-ffmpeg.sh
set -eu
cd "$(dirname "$0")/.."

BASE="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"

fetch() {
  url="$1"
  out="$2"
  if [ -s "$out" ]; then
    echo "já existe: $out"
    return
  fi
  echo "baixando: $out"
  curl -fL --retry 3 --connect-timeout 20 -o "$out.gz" "$url"
  gunzip -c "$out.gz" > "$out"
  rm -f "$out.gz"
  chmod +x "$out"
}

mkdir -p tools/ffmpeg/darwin-x64 tools/ffmpeg/darwin-arm64 tools/ffmpeg/win32-x64
fetch "$BASE/ffmpeg-darwin-x64.gz" "tools/ffmpeg/darwin-x64/ffmpeg"
fetch "$BASE/ffmpeg-darwin-arm64.gz" "tools/ffmpeg/darwin-arm64/ffmpeg"
fetch "$BASE/ffmpeg-win32-x64.gz" "tools/ffmpeg/win32-x64/ffmpeg.exe"

echo "ffmpeg pronto em tools/ffmpeg/"
