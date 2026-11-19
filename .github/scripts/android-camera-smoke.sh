#!/usr/bin/env bash
set -euo pipefail
PKG="br.edu.padrenicolaubaltazar.pss1"
APK="/tmp/pss1-apk/app-release.apk"
mkdir -p camera-smoke-results
test -s "$APK"

echo "Emulator CPU ABI: $(adb shell getprop ro.product.cpu.abi)"
unzip -l "$APK" | grep -E 'lib/[^/]+/lib(hermes|reactnative|nitro|skia)' | head -25 || true
dump_diagnostics() {
  mkdir -p camera-smoke-results
  adb logcat -d -v threadtime > camera-smoke-results/logcat.txt || true
  adb shell dumpsys activity activities > camera-smoke-results/activities.txt || true
  adb exec-out screencap -p > camera-smoke-results/crash-screen.png || true
  echo "== FATAL EXCEPTION / native load errors =="
  grep -E -A 20 'FATAL EXCEPTION|UnsatisfiedLinkError|No implementation found|dlopen failed|Fatal signal|AndroidRuntime|ReactNativeJS|expo' camera-smoke-results/logcat.txt | tail -160 || true
}
trap 'dump_diagnostics' EXIT
adb install -r "$APK"
adb shell pm grant "$PKG" android.permission.CAMERA
adb shell am start -n "$PKG/.MainActivity"
sleep 8
adb shell pidof "$PKG" >/dev/null || { echo "APP CRASHED ON START"; exit 1; }

dump_ui() {
  adb shell uiautomator dump /sdcard/pss-ui.xml >/dev/null
  adb exec-out cat /sdcard/pss-ui.xml > camera-smoke-results/ui.xml
}
tap_text() {
  local keyword="$1"
  local coords
  coords=$(KEYWORD="$keyword" python3 - <<'PY'
import os, re, xml.etree.ElementTree as ET
root=ET.parse('camera-smoke-results/ui.xml').getroot()
for node in root.iter():
    txt=node.attrib.get('text','') + ' ' + node.attrib.get('content-desc','')
    if os.environ['KEYWORD'] in txt:
        bounds=node.attrib.get('bounds','')
        values=list(map(int,re.findall(r'\d+',bounds)))
        if len(values)==4:
            print((values[0]+values[2])//2,(values[1]+values[3])//2)
            break
PY
)
  if [ -z "$coords" ]; then
    echo "UI control not found: $keyword"
    cat camera-smoke-results/ui.xml
    exit 1
  fi
  adb shell input tap $coords
}
dump_ui
tap_text "Ler QR Code"
sleep 10
adb shell pidof "$PKG" >/dev/null || { echo "CRASH WHEN OPENING QR"; exit 1; }
adb exec-out screencap -p > camera-smoke-results/qr.png
dump_ui
tap_text "Sair"
sleep 4
dump_ui
tap_text "Ler cartão"
sleep 18
adb shell pidof "$PKG" >/dev/null || { echo "CRASH WHEN OPENING OMR"; exit 1; }
adb exec-out screencap -p > camera-smoke-results/omr.png
dump_ui
if grep -q 'Falha na leitura' camera-smoke-results/ui.xml; then
  echo "OMR processor reported an exception:"
  cat camera-smoke-results/ui.xml
  exit 1
fi
if ! grep -qE '[0-9]+/10' camera-smoke-results/ui.xml; then
  echo "No frame processing result on screen (expected 0/10 on empty emulator camera)."
  cat camera-smoke-results/ui.xml
  exit 1
fi
echo "CAMERA SMOKE PASS: QR opened, OMR returned processed frames, app remained alive."
