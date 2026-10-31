#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "$0")/.." && pwd)
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 CHROMIUM_CHECKOUT_ROOT" >&2
  exit 2
fi
checkout_root=$1
src="$checkout_root/src"
expected_commit=4c20950d2f187a6976cf5e2a1234ca896dcdfd1c
depot_tools="$repo_root/.tools/depot_tools"

if [[ ! -d "$src/.git" || ! -x "$depot_tools/gclient" || ! -x "$src/buildtools/mac/gn" ]]; then
  echo "Chromium source or depot_tools missing; see docs/CHROMIUM_BUILD_LOG.md" >&2
  exit 2
fi

actual_commit=$(git -C "$src" rev-parse HEAD)
if [[ "$actual_commit" != "$expected_commit" ]]; then
  echo "Expected stable Chromium $expected_commit; got $actual_commit" >&2
  exit 2
fi

export PATH="$src/buildtools/mac:$PATH:$depot_tools"
export DEPOT_TOOLS_UPDATE=0
log_dir="$repo_root/.build/g1-logs"
mkdir -p "$log_dir"

echo "Syncing DEPS for Chromium $actual_commit"
(cd "$checkout_root" && gclient sync) 2>&1 | tee "$log_dir/gclient-sync.log"
if [[ "$(git -C "$src" rev-parse HEAD)" != "$expected_commit" ]]; then
  echo "gclient sync changed the pinned Chromium commit; aborting" >&2
  exit 2
fi

out="$src/out/GridG1"
mkdir -p "$out"
cat > "$out/args.gn" <<'GN_ARGS'
is_debug = false
is_component_build = true
symbol_level = 0
use_lld = false
target_cpu = "arm64"
GN_ARGS

echo "Generating GN build in $out"
(cd "$src" && gn gen out/GridG1) 2>&1 | tee "$log_dir/gn-gen.log"

echo "Building chrome; logs in $log_dir"
(cd "$src" && autoninja -C out/GridG1 chrome) 2>&1 | tee "$log_dir/autoninja-chrome.log"

test -x "$out/Chromium.app/Contents/MacOS/Chromium"
echo "Built $out/Chromium.app"
