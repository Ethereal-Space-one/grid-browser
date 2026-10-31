# G1 Chromium 源码与构建日志

> 2026-10-30 至 2026-10-31。此文件记录更名前的 Lattice G1 构建实验；当前产品名为 Grid。`LatticeG1` 是历史构建目录名，不代表另一产品。不把源码下载或工具安装视为浏览器已构建。依据 [Chromium macOS 官方构建说明](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/mac_build_instructions.md)。
> 当前公开构建脚本使用 `out/GridG1`，因此不会复用此历史目录的中间产物。

## 环境

- 设备：Apple Silicon Mac，8 个逻辑 CPU、16 GiB 内存；Xcode 27.1，macOS 27.0 SDK；可用磁盘开始时约 331 GiB。
- `depot_tools`：官方仓库，初始提交 `37e67d87efb841c1633c9943cdc334ecb523b921`，位于被 Git 忽略的 `.tools/depot_tools`。
- Chromium checkout 放在 `/private/tmp` 的 ASCII 路径，避免源码工具链对中文工作目录的潜在兼容问题。构建成功后需把固定版本与补丁记录迁入仓库；临时目录不属于可复现交付物。

## 已执行

1. `DEPOT_TOOLS_UPDATE=0 ./ensure_bootstrap`：核心 bootstrap 完成；可选的 `gsutil.py` 检查报缺少 `luci-auth`，脚本仍以 0 退出。后续以实际 `fetch` 判定是否阻塞。
2. 在 `/private/tmp/lattice-chromium-g1` 执行 `fetch --no-history chromium`：`gclient sync` 对 `src` 的浅层 git fetch 连续失败两次，未取得源码对象。已终止自动重试，保留最小失败目录供排查。官方源的 `git ls-remote ... HEAD` 则可成功返回，说明不是完全无法解析或连接。
3. 改用官方文档列出的 `fetch --git-cache chromium`，将共享 cache 限定在 `/private/tmp/lattice-git-cache`，checkout 在 `/private/tmp/lattice-chromium-cache-g1`。14.3 GiB 的官方源码 cache 快照完整下载，`src` 工作树已建立。为避免继续拉取 main 的不匹配依赖，主动终止正在进行的 main 依赖同步。
4. 用 [Google Chrome 官方版本历史 API](https://versionhistory.googleapis.com/v1/chrome/platforms/mac/channels/stable/versions?pageSize=1) 查询，macOS stable 当前返回 `157.0.8103.26`；[Chromium Gitiles 对应 tag](https://chromium.googlesource.com/chromium/src/+show/refs/tags/157.0.8103.26) 返回 HTTP 200。main checkout 原 commit 为 `ce5a57fa9c5a4979f84dc4825d1c3b6f1eee72bd`；本地 stable tag 解析为 `4c20950d2f187a6976cf5e2a1234ca896dcdfd1c`。
5. `git checkout --detach 157.0.8103.26` 已成功；随后 `gclient sync` 按该 tag 的 DEPS 完整通过，已跟踪工作树无改动。
6. `gn gen out/LatticeG1` 通过：从 5047 个文件生成 36674 个目标，约 7.6 秒。实验参数：arm64、`is_debug=false`、`is_component_build=true`、`symbol_level=0`、`use_lld=false`；没有关闭浏览器沙箱或站点隔离。
7. 首次 `autoninja -C out/LatticeG1 chrome` 在约 54 秒、938 个步骤后失败：ANGLE 的 Metal 着色器编译器缺失，Xcode 报 `xcodebuild -downloadComponent MetalToolchain`。按 [Apple 官方组件说明](https://developer.apple.com/documentation/xcode/downloading-and-installing-additional-xcode-components) 下载并安装 Metal Toolchain 27A266a；`xcodebuild -showComponent MetalToolchain -json` 返回 `installed`，运行 `xcrun --kill-cache` 后 `xcrun metal -v` 成功。
8. 已重新执行 `scripts/build-chromium-g1.sh`；编译越过原失败点。日志最后记录约 `19656/73393` 步、43 分钟，之后没有构建完成或失败的终结记录；2026-10-31 检查时 Chromium 可执行文件不存在。该首建尚未完成，已有中间产物可用原 checkout 增量继续。完成后运行 `scripts/smoke-chromium-g1.sh`，以独立临时资料档检验本地页面渲染。G1 尚未通过。

## 后续构建门槛

首次构建使用本地 arm64、组件化与无调试符号配置，并记录实际 args、构建耗时、磁盘占用和运行结果。任何禁用沙箱、站点隔离或证书校验的“成功构建”都不能计入 G1。
