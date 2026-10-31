# Chromium G1 build experiment (macOS arm64)

This is a baseline build of upstream Chromium for the Grid kernel decision. It does not include Grid browser UI or search integration, and a successful build alone does not satisfy the G1 gate. The historical local run is recorded in [CHROMIUM_BUILD_LOG.md](./CHROMIUM_BUILD_LOG.md).

Follow the [official Chromium macOS build instructions](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/mac_build_instructions.md) for supported Xcode and operating system requirements. The pinned source is Chromium `157.0.8103.26`, commit `4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`. This experiment needs substantial free disk space and may take hours on a laptop.

From the Grid repository root:

```sh
mkdir -p .tools
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git .tools/depot_tools
export PATH="$PWD/.tools/depot_tools:$PATH"
mkdir -p .local/chromium
cd .local/chromium
fetch --git-cache chromium
git -C src checkout --detach 157.0.8103.26
gclient sync
cd ../..
bash scripts/build-chromium-g1.sh "$PWD/.local/chromium"
bash scripts/smoke-chromium-g1.sh "$PWD/.local/chromium"
```

If Xcode reports a missing Metal Toolchain, install it with `xcodebuild -downloadComponent MetalToolchain`, then run `xcrun --kill-cache` before retrying the build. The build script verifies the exact Chromium commit, syncs its dependencies and writes logs under the ignored `.build/g1-logs/` directory. Its GN configuration does not disable the browser sandbox, site isolation or certificate checks.

The upstream Chromium source, `depot_tools`, GN output and build logs are excluded from this Git repository. Changes to Chromium will be published as a pinned patch set after the baseline build and browser integration are verified.
