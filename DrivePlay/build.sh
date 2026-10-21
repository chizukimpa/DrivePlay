#!/bin/zsh
# Compila o DrivePlay.app a partir das fontes Swift (não precisa de Xcode completo).
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="DrivePlay"
BUILD_DIR="build"
APP="$BUILD_DIR/$APP_NAME.app"
ARCH="$(uname -m)"
ICON_WORK="$BUILD_DIR/icon"

rm -rf "$BUILD_DIR"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" "$ICON_WORK"

echo "→ Compilando fontes…"
swiftc -O -target "${ARCH}-apple-macos14.0" Sources/*.swift -o "$APP/Contents/MacOS/$APP_NAME"

cp Resources/Info.plist "$APP/Contents/Info.plist"

echo "→ Gerando ícone…"
if command -v iconutil >/dev/null 2>&1; then
    swift Tools/make_icon.swift "$ICON_WORK" >/dev/null

    ICONSET="$BUILD_DIR/AppIcon.iconset"
    mkdir -p "$ICONSET"
    cp "$ICON_WORK/icon_16.png"   "$ICONSET/icon_16x16.png"
    cp "$ICON_WORK/icon_32.png"   "$ICONSET/icon_16x16@2x.png"
    cp "$ICON_WORK/icon_32.png"   "$ICONSET/icon_32x32.png"
    cp "$ICON_WORK/icon_64.png"   "$ICONSET/icon_32x32@2x.png"
    cp "$ICON_WORK/icon_128.png"  "$ICONSET/icon_128x128.png"
    cp "$ICON_WORK/icon_256.png"  "$ICONSET/icon_128x128@2x.png"
    cp "$ICON_WORK/icon_256.png"  "$ICONSET/icon_256x256.png"
    cp "$ICON_WORK/icon_512.png"  "$ICONSET/icon_256x256@2x.png"
    cp "$ICON_WORK/icon_512.png"  "$ICONSET/icon_512x512.png"
    cp "$ICON_WORK/icon_1024.png" "$ICONSET/icon_512x512@2x.png"

    iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
fi

echo "→ Assinando (ad-hoc)…"
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

echo ""
echo "✅ App pronto: $APP"
echo "   Abra com: open \"$APP\""

if [[ "${1:-}" == "--install" ]]; then
    echo ""
    echo "→ Copiando para /Applications…"
    rm -rf "/Applications/$APP_NAME.app"
    if cp -R "$APP" "/Applications/$APP_NAME.app"; then
        echo "✅ Instalado em /Applications/$APP_NAME.app"
    else
        echo "⚠️  Não foi possível copiar para /Applications (sem permissão)."
        echo "   Arraste $APP para a pasta Aplicativos manualmente."
    fi
fi
