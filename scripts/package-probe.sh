#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
configuration=${1:-debug}
case "$configuration" in
  debug|release) ;;
  *) echo "usage: $0 [debug|release]" >&2; exit 2 ;;
esac

bundle="$root/.build/GridBrowserProbe.app"
binary="$root/.build/$configuration/GridBrowserProbe"
if [ ! -x "$binary" ]; then
  echo "Build first: swift build -c $configuration" >&2
  exit 1
fi
mkdir -p "$bundle/Contents/MacOS"
cp "$binary" "$bundle/Contents/MacOS/GridBrowserProbe"
cp "$root/Packaging/Info.plist" "$bundle/Contents/Info.plist"
echo "$bundle"
