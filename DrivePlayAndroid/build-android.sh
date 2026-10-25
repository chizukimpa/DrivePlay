#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
JAVA_HOME="${JAVA_HOME:-$HOME/Library/Android/jdk-17/Contents/Home}"
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-37.0.0}"
PLATFORM_VERSION="${PLATFORM_VERSION:-37.0}"
TARGET_SDK="${TARGET_SDK:-37}"
VERSION_NAME="${VERSION_NAME:-1.2.0}"
VERSION_CODE="${VERSION_CODE:-3}"

BT="$SDK/build-tools/$BUILD_TOOLS_VERSION"
PLATFORM="$SDK/platforms/android-$PLATFORM_VERSION/android.jar"
PROJECT="$ROOT/app/src/main"
OUT="$ROOT/build"

export JAVA_HOME
export PATH="$JAVA_HOME/bin:$PATH"

if [ ! -f "$PLATFORM" ]; then
  echo "Android platform not found: $PLATFORM" >&2
  echo "Run: sdkmanager \"platforms;android-$PLATFORM_VERSION\" \"build-tools;$BUILD_TOOLS_VERSION\"" >&2
  exit 1
fi
if [ ! -x "$BT/aapt2" ]; then
  echo "Android build-tools not found: $BT" >&2
  exit 1
fi

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex"

echo "[1/6] Compiling Java..."
find "$PROJECT/java" -name '*.java' -print0 | xargs -0 javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
  -classpath "$PLATFORM" \
  -d "$OUT/classes"

echo "[2/6] Dexing..."
find "$OUT/classes" -name '*.class' -print0 | xargs -0 "$BT/d8" \
  --release --min-api 24 --lib "$PLATFORM" --output "$OUT/dex"

echo "[3/6] Compiling resources..."
mkdir -p "$OUT/res"
"$BT/aapt2" compile --dir "$PROJECT/res" -o "$OUT/res.zip"

echo "[4/6] Linking APK..."
"$BT/aapt2" link \
  -o "$OUT/unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$PROJECT/AndroidManifest.xml" \
  "$OUT/res.zip" \
  -A "$PROJECT/assets" \
  --min-sdk-version 24 \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME"

cp "$OUT/unsigned.apk" "$OUT/unaligned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unaligned.apk" classes.dex)

echo "[5/6] Aligning..."
"$BT/zipalign" -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

echo "[6/6] Signing..."
KEYSTORE="$ROOT/keystore/driveplay-release.jks"
if [ ! -f "$KEYSTORE" ]; then
  mkdir -p "$ROOT/keystore"
  keytool -genkeypair \
    -keystore "$KEYSTORE" \
    -alias driveplay \
    -keyalg RSA \
    -keysize 2048 \
    -validity 10000 \
    -storepass driveplay \
    -keypass driveplay \
    -dname "CN=DrivePlay, OU=Mobile, O=DrivePlay, L=Sao Paulo, ST=SP, C=BR" \
    >/dev/null 2>&1
fi

APK="$OUT/DrivePlay-Android-$VERSION_NAME.apk"
"$BT/apksigner" sign \
  --ks "$KEYSTORE" \
  --ks-key-alias driveplay \
  --ks-pass pass:driveplay \
  --key-pass pass:driveplay \
  --out "$APK" \
  "$OUT/aligned.apk"

"$BT/apksigner" verify --verbose "$APK"
echo
echo "APK ready: $APK"
ls -lh "$APK"
