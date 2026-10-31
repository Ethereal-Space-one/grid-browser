# Grid Browser

Grid 是从用户意图出发的开源浏览器：让人更快找到、理解并使用真实网页，同时始终掌控方向。当前仍处 **T0/G1 对照实验**，不是可日用的正式浏览器。

从 [PLAN.md](./PLAN.md) 的用户目标开始，技术路线和验收门槛见 [TECHNICAL_PLAN.md](./TECHNICAL_PLAN.md)。Grid 早期使用 Lattice 开发代号；实验性 `.lattice` 证据格式是独立的按需能力。

## 当前代码

- `Sources/GridCore/OmniboxIntent.swift`：网址与查询分流；网址不调用模型，查询走明确的搜索回退。
- `Sources/GridBrowserProbe/main.swift`：Swift 6/AppKit/WebKit 对照样机，包含地址栏、前进后退、重载、标签和真实网页。
- `fixtures/web/`：本地导航、动态表单、iframe、下载夹具。
- `prototypes/search-lab/`：可交互的结果优先搜索页，用录制数据验证信息层级与失败状态；不执行实时检索。
- `docs/T0_TASKS.md`：28 个可复跑用户任务（含 Agent 预览与接管）；`docs/t0-results.template.csv` 是记录模板，参与者原始记录不进入 Git。
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
python3 -m http.server 8765 --bind 127.0.0.1 --directory fixtures/web
```

在样机地址栏输入 `localhost:8765`。快捷键：`⌘L` 聚焦地址栏、`⌘T` 新标签、`⌘W` 关闭标签、`⌘R` 重载。

搜索交互原型可直接用浏览器打开 `prototypes/search-lab/index.html`。它只演示“结果先出现、总结随后填入固定位置、原页可打开”和失败回退；不能用它测检索质量或 AI 准确性。

## 当前限制与下一步

样机搜索使用外部 Bing 页面；录制数据搜索原型尚未接入浏览器地址栏。两者分别验证真实网页浏览与搜索页交互，不替代 T2 搜索闭环。Agent 控制预览仍在计划阶段，A01–A04 的真实执行记为“未实现”。Chromium G1 完整构建、Agent、证据和安全更新通道尚未完成。下一步完成 T0 用户任务基线与 Agent 控制预览原型，同时推进内核决策门，再在选定的浏览器中接入真实搜索页。
