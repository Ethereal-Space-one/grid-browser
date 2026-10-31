#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 CHROMIUM_CHECKOUT_ROOT" >&2
  exit 2
fi
checkout_root=$1
browser="$checkout_root/src/out/GridG1/Chromium.app/Contents/MacOS/Chromium"

if [[ ! -x "$browser" ]]; then
  echo "Chromium binary is missing: $browser" >&2
  exit 2
fi

version=$("$browser" --version)
if [[ "$version" != *"157.0.8103.26"* ]]; then
  echo "Unexpected Chromium version: $version" >&2
  exit 1
fi

profile=$(mktemp -d "${TMPDIR:-/tmp}/lattice-g1-profile.XXXXXX")
output=$(mktemp "${TMPDIR:-/tmp}/lattice-g1-dom.XXXXXX")
errors=$(mktemp "${TMPDIR:-/tmp}/lattice-g1-errors.XXXXXX")
trap 'rm -rf "$profile"; rm -f "$output" "$errors"' EXIT

fixture_url="file://$repo_root/fixtures/web/index.html"
if ! "$browser" \
  --headless \
  --no-first-run \
  --disable-default-apps \
  --user-data-dir="$profile" \
  --dump-dom \
  "$fixture_url" >"$output" 2>"$errors"; then
  echo "Chromium failed to start or render the fixture" >&2
  tail -n 20 "$errors" >&2
  exit 1
fi

if ! rg -q 'Grid 浏览任务夹具' "$output" ||
   ! rg -q '橘色风筝落在蓝色屋顶上' "$output"; then
  echo "Chromium launched, but fixture content was not rendered as expected" >&2
  exit 1
fi

echo "PASS: $version launched and rendered the local fixture"
