# Grid Browser

Grid 是从用户意图出发的开源浏览器：让人更快找到、理解并使用真实网页，同时始终掌控方向。当前仍处 **T0/G1 对照实验**，不是可日用的正式浏览器。产品原型采用 Electron/Chromium，首发面向 macOS 开发者；现有 Swift/WebKit 样机已冻结，仅保留历史对照。

从 [PLAN.md](./PLAN.md) 的用户目标开始，技术路线和验收门槛见 [TECHNICAL_PLAN.md](./TECHNICAL_PLAN.md)。Grid 早期使用 Lattice 开发代号；实验性 `.lattice` 证据格式是独立的按需能力。

当前版本 **0.2.0 开发者预览**：同窗阅读、探索标签与底部浮动链式地图、本地任务恢复，API key 仅本次运行使用，不触发钥匙串密码提示。变更、验证及边界见[0.2.0 发布说明](./docs/releases/0.2.0.md)；下载见 [GitHub Releases](https://github.com/Ethereal-Space-one/grid-browser/releases)。

v0.1.0 的本机预览及三项试用任务见[开发者预览说明](./docs/DEVELOPER_PREVIEW_2026-11-04.md)。下一阶段的候选比较、源码发现与实验顺序见[架构调查](./docs/ARCHITECTURE_RESEARCH_2026-11-04.md)及[ADR 0002 提案](./docs/adr/0002-next-stage-architecture.md)；最终内核尚未选定。

当前源码已完成[请求/上下文第一切片](./docs/SMOKE_REQUESTS_2026-11-04.md)及[窗口/标签内存状态切片](./docs/SMOKE_TABS_2026-11-04.md)：独立查询与阅读位置、原生页面状态保留、后台请求归属和跨标签/窗口授权失效。26 项本地检查、13 组标签窗口检查及既有流程回归通过。该阶段尚未实现完整退出恢复，后续第 5 步已完成本机验证；既有 v0.1.0 包不自动包含这些改动，运行当前源码请用原型目录的 `npm start`。

接续的链式地图前三步已完成内存分支、宿主导航及[可点击路径栏/地图](./docs/SMOKE_PATH_MAP_2026-11-04.md)：默认一行路径，展开可找回旧分支，与前进/后退使用同一当前节点。同网址访问不混淆，Grid 返回/刷新不会重发 POST；按需短总结与独立“问这页”已通过[4A 本地验证](./docs/SMOKE_UNDERSTANDING_2026-11-04.md)（46 项本地检查、9 组理解流程）。[4B 两份来源对照](./docs/SMOKE_COMPARISON_2026-11-05.md)已接主动选源、独立对照、依据定位与缺失补取（55 项本地检查、11 组对照）。[4C 我的判断](./docs/SMOKE_JUDGMENT_2026-11-05.md)已接用户文字、固定引文和待核事项的草稿/版本（62 项本地检查、9 组判断流程）；[第 5 步保存/恢复/删除](./docs/SMOKE_STORAGE_2026-11-05.md)已有 74 项本地检查及四个独立进程恢复验证；[第 6 步](./docs/SMOKE_JOURNEY_2026-11-05.md)已完成 UX 精修、75 项本地检查与独立包验证；[真人试用](./docs/TRIAL_CHAIN_MAP_2026-11-05.md)由用户进行，真实内容质量和收益待评价。

2026-11-05 用户确认[同窗阅读交互模板](./docs/READING_FLOW_DESIGN_2026-11-05.md)后，已接入首个可运行版本：结果标题直达原页、上方按需总结、右侧问答；左侧探索标签与底部地图共同切换。浮动地图支持横竖、定位、保留后续的单点移除/撤销和从节点续接，两行标题与两行摘录保留。77 项本地、11 组新动线及既有回归通过。该阶段的历史本机包在 `prototypes/electron-m0/.local/reading-flow-preview/`；本次版本包见 0.2.0 发布说明。[验证和限制](./docs/SMOKE_READING_FLOW_2026-11-05.md)明确区分图片、多轮、真实内容质量、窗口生命周期和最终视觉验收。

## 当前代码

- `Sources/GridCore/OmniboxIntent.swift`：网址与查询分流；网址不调用模型，查询走明确的搜索回退。
- `Sources/GridBrowserProbe/main.swift`：已冻结的 Swift 6/AppKit/WebKit 对照样机，包含地址栏、前进后退、重载、标签和真实网页。
- `fixtures/web/`：本地导航、动态表单、iframe、下载及 VP9/Opus 音视频/字幕夹具。
- `prototypes/search-lab/`：可交互的结果优先搜索页，用录制数据验证信息层级与失败状态；不执行实时检索。
- `prototypes/electron-m0/`：Electron v0.2.0 原型，支持网址直达、DeepSeek Search/Fetch、五场景提取、真实原页、MCP 授权读取和本地固定字段提案/确认；运行方法和未完成项见[原型说明](./prototypes/electron-m0/README.md)。
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

Swift 样机搜索使用外部 Bing 页面且已冻结。Electron 的搜索/Fetch/原页与 MCP 读取已有[实测](./docs/SMOKE_ELECTRON_2026-11-02.md)，Codex CLI 与 Claude Code 也通过了[合成页面读取](./docs/SMOKE_HOSTS_2026-11-03.md)和[受限填写提案](./docs/UX_HOST_FORMS_2026-11-03.md)。五场景真实接口、系统外观、key 存储及本机 app smoke 见[预览记录](./docs/DEVELOPER_PREVIEW_2026-11-04.md)。这些不证明真人收益、提取忠实度、通用表单或正式安全模型。

目前已有内存中的窗口/标签、混合导航及可点击分支地图，任务退出恢复已有本机验证，仍缺下载、站点权限等日用基础及广泛站点兼容；V01–V02 媒体/会议、跨机器安装、公证和安全更新尚未验收。本机链式地图和任务恢复已有自动证据，独立试用包与步骤见[试用说明](./docs/TRIAL_CHAIN_MAP_2026-11-05.md)；真人任务基线与内容质量由用户评价。接续工程先完成同窗首版的真人验收、系统窗口/视觉检查及已列出的交互缺口，再做受限动作结果核对、可替换检索与分发。Chromium fork 尚未获选，完整内核构建不作为当前前置；证据格式继续后置。
