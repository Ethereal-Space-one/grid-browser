# Grid Browser

Grid 是从用户意图出发的开源浏览器：让人更快找到、理解并使用真实网页，同时始终掌控方向。当前仍处 **T0/G1 对照实验**，不是可日用的正式浏览器。产品原型采用 Electron/Chromium，首发面向 macOS 开发者；现有 Swift/WebKit 样机已冻结，仅保留历史对照。

从 [PLAN.md](./PLAN.md) 的用户目标开始，技术路线和验收门槛见 [TECHNICAL_PLAN.md](./TECHNICAL_PLAN.md)。Grid 早期使用 Lattice 开发代号；实验性 `.lattice` 证据格式是独立的按需能力。

## 当前代码

- `Sources/GridCore/OmniboxIntent.swift`：网址与查询分流；网址不调用模型，查询走明确的搜索回退。
- `Sources/GridBrowserProbe/main.swift`：已冻结的 Swift 6/AppKit/WebKit 对照样机，包含地址栏、前进后退、重载、标签和真实网页。
- `fixtures/web/`：本地导航、动态表单、iframe、下载及 VP9/Opus 音视频/字幕夹具。
- `prototypes/search-lab/`：可交互的结果优先搜索页，用录制数据验证信息层级与失败状态；不执行实时检索。
- `prototypes/electron-m0/`：可运行的 Electron 首个切片，支持网址直达、DeepSeek Search 结果、Fetch 正文与真实原页；运行方法和未完成项见[原型说明](./prototypes/electron-m0/README.md)。
- `docs/T0_TASKS.md`：30 个可复跑用户任务（含 Agent 预览/接管和媒体/会议）；`docs/t0-results.template.csv` 是记录模板，参与者原始记录不进入 Git。
- `docs/BROWSER_FOUNDATIONS.md`：媒体、会议与日用网页能力矩阵；说明 Video.js 在 Grid 中的适用边界。
- `docs/media-results.template.csv`：媒体格式、实际播放与系统行为的记录模板；原始记录不进入 Git。
- `docs/G1_ENGINE_DECISION.md`：Chromium 与 WebKit 同负载决策门及当前实测边界。
- `scripts/build-chromium-g1.sh`：在固定 stable 提交上同步 DEPS、生成独立 GN 配置并构建 `chrome`；完整复现步骤见 [Chromium G1 构建说明](./docs/BUILD_CHROMIUM.md)。本仓库不包含 Chromium 源码、工具链或构建产物。
- `scripts/smoke-chromium-g1.sh`：构建完成后用临时资料档启动 Chromium，验证本地页面能被渲染。

## 在 macOS 运行样机

需要 macOS 14+ 与 Xcode/Swift 6 工具链。

```sh
swift test
swift build
sh scripts/package-probe.sh debug
open .build/GridBrowserProbe.app
```

本地任务夹具：

```sh
python3 scripts/serve-fixtures.py
```

在样机地址栏输入 `localhost:8765`。媒体夹具在 `http://127.0.0.1:8765/media.html`，可按 V01 检查视频、声音、字幕和切换标签；完整样本说明见 [夹具文档](./fixtures/web/README.md)。快捷键：`⌘L` 聚焦地址栏、`⌘T` 新标签、`⌘W` 关闭标签、`⌘R` 重载。

搜索交互原型可直接用浏览器打开 `prototypes/search-lab/index.html`。它只演示“结果先出现、总结随后填入固定位置、原页可打开”和失败回退；不能用它测检索质量或 AI 准确性。

## 当前限制与下一步

Swift 样机搜索使用外部 Bing 页面；录制数据搜索原型尚未接入样机地址栏。Electron 首个切片已用真实 key 跑通一次搜索、Fetch 阅读、原页打开及返回结果的流程，见[实测记录](./docs/SMOKE_ELECTRON_2026-11-02.md)；这不替代 T2 搜索闭环。本机 stdio/MCP 桥接与 Agent 控制预览仍未实现，A01–A04 的真实执行记为“未实现”；V01–V02 的媒体与会议任务尚未实测。Chromium G1 完整构建、证据和安全更新通道尚未完成。下一步在 Electron 中加入本机桥接、页面只读能力和可接管动作，并建立开发者任务基线；正式安全模型另行验收。
