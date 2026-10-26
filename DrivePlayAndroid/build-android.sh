#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
JAVA_HOME="${JAVA_HOME:-$HOME/Library/Android/jdk-17/Contents/Home}"
BUILD_TOOLS_VERSION="${BUILD_TOOLS_VERSION:-37.0.0}"
PLATFORM_VERSION="${PLATFORM_VERSION:-37.0}"
TARGET_SDK="${TARGET_SDK:-37}"
VERSION_NAME="${VERSION_NAME:-1.3.1}"
VERSION_CODE="${VERSION_CODE:-5}"

BT="$SDK/build-tools/$BUILD_TOOLS_VERSION"
PLATFORM="$SDK/platforms/android-$PLATFORM_VERSION/android.jar"
PROJECT="$ROOT/app/src/main"
LIBS="$ROOT/libs"
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

# Unpack the bundled AARs (Media3/ExoPlayer) once.
mkdir -p "$LIBS/x"
for aar in "$LIBS"/aar/*.aar; do
  name="$(basename "$aar" .aar)"
  if [ ! -f "$LIBS/x/$name/classes.jar" ]; then
    rm -rf "$LIBS/x/$name"
    mkdir -p "$LIBS/x/$name"
    (cd "$LIBS/x/$name" && unzip -qo "$aar")
  fi
done

rm -rf "$OUT"
mkdir -p "$OUT/classes" "$OUT/dex" "$OUT/rjava"

# Release builds are not debuggable. Local device testing can opt in with
# DEBUGGABLE=1 ./build-android.sh (needed for the WebView/CDP tooling).
MANIFEST="$PROJECT/AndroidManifest.xml"
if [ "${DEBUGGABLE:-0}" = "1" ]; then
  MANIFEST="$OUT/AndroidManifest.xml"
  sed 's#<application#<application android:debuggable="true"#' \
    "$PROJECT/AndroidManifest.xml" > "$MANIFEST"
fi

echo "[1/7] Compiling resources..."
"$BT/aapt2" compile --dir "$PROJECT/res" -o "$OUT/res.zip"
if [ -d "$LIBS/x/media3-exoplayer/res" ]; then
  "$BT/aapt2" compile --dir "$LIBS/x/media3-exoplayer/res" -o "$OUT/exoplayer-res.zip"
fi

echo "[2/7] Linking APK..."
RES_INPUTS=("$OUT/res.zip")
if [ -f "$OUT/exoplayer-res.zip" ]; then RES_INPUTS+=("$OUT/exoplayer-res.zip"); fi
"$BT/aapt2" link \
  -o "$OUT/unsigned.apk" \
  -I "$PLATFORM" \
  --manifest "$MANIFEST" \
  "${RES_INPUTS[@]}" \
  -A "$PROJECT/assets" \
  --extra-packages androidx.media3.exoplayer \
  --java "$OUT/rjava" \
  --min-sdk-version 24 \
  --target-sdk-version "$TARGET_SDK" \
  --version-code "$VERSION_CODE" \
  --version-name "$VERSION_NAME"

echo "[3/7] Compiling Java..."
LIBS_CP=()
for jar in "$LIBS"/x/*/classes.jar "$LIBS"/jar/*.jar; do
  if [ -f "$jar" ]; then LIBS_CP+=("$jar"); fi
done
JAVA_SOURCES=()
while IFS= read -r -d '' file; do JAVA_SOURCES+=("$file"); done < <(
  find "$PROJECT/java" "$OUT/rjava" -name '*.java' -print0
)
CP="$PLATFORM"
for jar in "${LIBS_CP[@]}"; do CP="$CP:$jar"; done
javac -encoding UTF-8 -source 8 -target 8 -Xlint:-options \
  -classpath "$CP" \
  -d "$OUT/classes" \
  "${JAVA_SOURCES[@]}"

echo "[4/7] Dexing..."
D8_INPUTS=()
while IFS= read -r -d '' file; do D8_INPUTS+=("$file"); done < <(
  find "$OUT/classes" -name '*.class' -print0
)
for jar in "${LIBS_CP[@]}"; do D8_INPUTS+=("$jar"); done
"$BT/d8" --release --min-api 24 --lib "$PLATFORM" --output "$OUT/dex" "${D8_INPUTS[@]}"

cp "$OUT/unsigned.apk" "$OUT/unaligned.apk"
(cd "$OUT/dex" && zip -q -X "$OUT/unaligned.apk" classes*.dex)

echo "[5/7] Aligning..."
"$BT/zipalign" -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

echo "[6/7] Signing..."
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
