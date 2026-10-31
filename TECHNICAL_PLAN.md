# Grid 技术方案与实施路线（v1.0）

> 2026-10-31。配套主文件：[PLAN.md](./PLAN.md)。本文件回答“如何把意图优先的开源浏览器做出来”，不改变 PLAN.md 的产品目标。Grid 是当前产品名，早期计划使用 Lattice 开发代号。
> 状态：实施方案。技术选型中标为“候选”的内容须经过对应决策门验证；本文不把 PoC 当成已完成的浏览器。

---

## 0. 永不偏离的产品约束

用户打开 Grid，是为了**自己决定要做什么，并更快地在真实网页上完成它**。每一项技术能力都必须通过以下问题：

1. 它是否减少了从意图到可用结果、原页或完成动作的时间与认知负担？
2. 它是否保留用户对方向、页面、登录态和 Agent 动作的控制？
3. 没有 AI、模型故障或网络受限时，浏览器是否仍能正常使用？
4. 它能否被外部用户独立安装、复现、检查和贡献？

第一屏只有标准浏览器输入入口；搜索页是短总结加结果列表；网页是完整网页；Agent、比较、证据按需出现。不得为了展示技术而增加常驻侧栏、模式选择、强制会话、证书流程或配置向导。

---

## 1. 从用户动作反推系统

| 用户动作 | 用户看到 | 系统必须做 | 验收 |
|---|---|---|---|
| 输入网址 | 立即进入真实网页 | 本地识别网址，走浏览器导航；不调用模型 | 不把网址误送检索；前进后退、登录与下载正常 |
| 输入查询 | 上方简短总结、下方可直接打开的结果 | 并行取得结果、异步总结；结果不等模型 | 无模型时仍有结果；首屏不被总结遮住 |
| 打开结果 | 原页和返回结果的清晰路径 | 在同一资料档导航，保留查询和滚动状态 | 返回无需重搜；页面权限按站点管理 |
| 比较页面 | 两页及其与原问题的关系 | 读取用户选定的页面，保留来源与位置 | 不自动读取其他标签或私密页面 |
| 请求 AI 帮忙 | 授权范围、过程、暂停和接管 | 由浏览器发能力授权，执行可观察动作 | 人类输入抢占；未知结果不重试写操作 |
| 核对或分享 | 原句、来源、抓取时间、可选文件 | 生成快照和 .lattice，分别标明各类保证 | 不把“引文存在”写成“结论正确” |

这张表是工程排期的依赖图：没有真实网页与正常导航，就不能宣称完成搜索体验；没有可验证的授权与真实页面操作，就不能宣称 Agent 可用；没有准确的证据语义，就不能宣称答案可审计。

---

## 2. 总体架构

    用户
      │
      ▼
    Chromium 浏览器窗口 ── 原生地址栏 / 标签 / 网页 / 权限
      │
      ├─ Grid WebUI（搜索结果、任务、按需比较）── Mojo ── Browser Service（C++）
      │                                                       ├─ Tab/Profile/Permission
      │                                                       ├─ Action Gate/审计事件
      │                                                       └─ Evidence Capture
      │
      └──────────────────────── 受限 IPC ──────────────────── AI Broker（独立进程）
                                                              ├─ Search/Fetch adapters
                                                              ├─ Model adapters
                                                              ├─ Intent/Task orchestration
                                                              └─ MCP server（可选启用）

边界定义：

- **浏览器进程是唯一权威**：页面、资料档、Cookie、下载、站点权限、动作授权与人类抢占的最终裁决都在这里。模型进程不能直接读 Cookie 数据库、调用任意浏览器内部 API 或绕过动作闸门。
- **网页渲染进程不可信**：页面文字、DOM、WebMCP 描述和工具输出都是数据，不会成为用户指令。
- **AI Broker 可替换**：崩溃、断网或没有模型时，浏览器本体继续工作。它只通过受限 IPC 读取获授权的页面信息，提出动作请求；Browser Service 再验证并执行。
- **WebUI 是产品界面，不是网页内容**：搜索与任务 UI 使用独立内部来源，界面到浏览器服务用有类型的 Mojo 接口。每个新增接口写明权限、调用方与失败方式。Chromium 官方把 WebUI、TypeScript 与 Mojo 作为现成路径。[Chromium WebUI 说明](https://chromium.googlesource.com/chromium/src/+/main/docs/webui/webui_explainer.md)

### 2.1 推荐技术栈

| 层 | 首选 | 理由与限制 |
|---|---|---|
| 网页内核与浏览器基础 | 跟踪 Chromium stable 的薄补丁 fork，C++ | 三大桌面平台复用浏览器基本能力、扩展体系与成熟安全隔离；必须建立频繁上游合并能力 |
| 浏览器窗口 | Chromium 原生 UI/Views，最少改动 | 保留惯用导航与无障碍行为，降低 patch 面积 |
| 搜索/任务页面 | Chromium WebUI，TypeScript + Lit，Mojo | 与 Chromium 构建、权限和本地化体系一致；避免再嵌一套桌面壳 |
| AI Broker | 独立 Rust 进程，版本化 IPC | 适合流式网络、状态与权限前检查；不拥有浏览器最终权限。与现有 Node PoC 共存，逐步迁移经过验证的逻辑 |
| 本地状态 | 浏览器资料档 + SQLite/内容寻址文件 | 任务元数据、来源与缓存分开；密钥使用系统安全存储 |
| 扩展入口 | MV3 兼容性测试 + 外部 MCP | 扩展是浏览器兼容问题；MCP 是 Agent 接入问题，二者不能混为一谈 |

Rust Broker 是推荐实现，不是安全性的替代品。进程边界、IPC 输入校验、浏览器主进程闸门和权限撤销都必须实际实现。现有 lattice Node CLI 可继续作为独立验证器和测试夹具；不应把它直接当作拥有浏览器权限的常驻服务。

Browser Service 启动并监管 Broker；两者优先采用版本化 Protobuf 消息，经操作系统本机管道通信（macOS/Linux 为 Unix domain socket，Windows 为 named pipe）。通道需校验对端进程身份、请求大小和授权令牌，不开放为可被网页访问的本地 HTTP 服务。协议升级支持能力协商和旧版拒绝，避免浏览器与 Broker 版本错配后静默越权。

### 2.2 内核决策门 G1

PLAN.md 仍要求同负载比较。这里给出明确默认路线：**优先做 Chromium 原生 fork**。在 M0 用 WebView 原型与 Chromium 原型完成同一组任务，记录网站兼容、资料档/登录、扩展、真实 Agent 动作、性能、无障碍和上游维护。若 Chromium 方案无法维持安全更新或简洁体验，再提交 ADR 改路线；不要未经实测默认拼接 WebView 与 headless Chromium 两套登录态。

Chromium 上游已采用频繁 stable 更新及每周安全刷新；Grid 的 fork 若不能跟进，就不具备公开浏览器的安全基础。[Chromium 发布周期](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/process/release_cycle.md)、[安全更新说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/updates.md)

### 2.3 把交互设计落实为界面状态

| 界面 | 默认信息层级 | 关键状态 | 工程验收 |
|---|---|---|---|
| 新标签与地址栏 | 输入入口、最近任务的轻量恢复入口 | 空白、输入中、网址/查询意图不确定 | 键盘直达、输入法不触发误提交、网址不经模型 |
| 搜索页 | 查询、固定高度的短总结槽、可点结果列表 | 检索中、已有结果、总结中、仅结果、无结果、部分来源失败 | 结果先出现；总结不造成布局跳动；结果始终可打开 |
| 真实网页 | 标准导航与网页内容 | 加载、登录、权限请求、下载、崩溃恢复 | 用户像普通浏览器一样完成常用网站任务 |
| 比较/任务面板 | 仅在用户请求后出现，紧邻当前两页或动作 | 选页、授权、进行中、暂停、未知结果、接管 | 来源和下一步可见；Esc/关闭不丢页面状态 |
| 核对入口 | 原句、来源、抓取时间、验证范围 | 未抓取、已锚定、语义待核、身份未验 | 不用一个“通过”混合不同保证 |

设计系统先定义间距、字体、颜色、焦点、加载与错误组件的 token；以 Chromium 原生控件行为为基准。搜索页在常见窗口宽度、缩放比例、浅色/深色、高对比度下保留结果首屏。每个交互原型都通过真实任务、键盘和屏幕阅读器验收后再固化为组件；不以视觉稿代替使用证据。

---

## 3. 内部契约：让模块真正可替换

接口用版本化 schema 定义，并生成 Rust/C++/TypeScript 类型。避免让 UI 依赖供应商字段名或 Agent 依赖页面坐标。

### 3.1 核心对象

- **IntentContext**：id、原始输入、用户确认过的目标、创建时间、关联的标签与查询、状态。每次搜索自动生成；用户不需要手动创建“空间”。
- **SearchHit**：规范化 URL、标题、摘要、来源、检索时间、发布日期（可空）、来源提供者、排序分数与解释字段。
- **PageHandle**：profileId、tabId、documentId、navigationId、origin、revision。导航后 documentId 改变，旧节点引用全部失效。
- **ModelCapabilities**：文字、图片、流式、工具调用、结构化输出、最大上下文、服务端状态等能力及约束。能力由适配器显式声明并通过合约测试验证。
- **AgentGrant**：taskId、允许的 origin、动作 verbs、敏感数据范围、到期时间、用户确认状态。授权可撤销，默认最小范围。
- **ActionRequest/Result**：taskId、page handle、预期 revision、操作、目标、幂等键、副作用类别；结果为 succeeded、failed、cancelled 或 unknown，并附可观察证据。
- **EvidenceRecord**：页面 URL、抓取方式、抓取时间、内容哈希、引文位置、可选签名身份；不能把内容哈希解释成来源真实性。

### 3.2 事件与状态

搜索、导航、页面读取、Agent 请求、授权、动作执行与证据抓取使用同一条本地事件序列。界面从事件中恢复任务进度；动作闸门检查当前文档、权限和栅栏。日志只记录必要元数据，默认不记录网页正文、密码或完整提示词。浏览器崩溃后能恢复标签与未完成任务，但未知写动作只能进入人工核对。

### 3.3 失败契约

每层都返回结构化错误：无结果、网络超时、抓取被拒、模型不支持所需能力、模型中断、页面已导航、授权失效、动作后置条件未知。UI 显示已有结果和下一步；不能把所有错误归并为“请重试”。

---

## 4. 搜索：先让结果可用，再让 AI 增强

### 4.1 数据流

1. 输入分类：网址直达；查询进入 Search；明确的操作请求才进入任务规划。
2. 查询标准化：保留用户原话，必要时生成至多少量改写，不能暗中改变搜索目标。
3. Search adapters 并行返回结果；去重并保留各来源信息，不使用未经测量的统一硬阈值。
4. 结果列表先渲染，标题、URL、摘要和可用日期立刻可点。
5. Model adapter 根据已返回的摘要生成两三句方向性总结；总结槽位置固定，不让页面跳动。
6. 若摘要不足、来源互相矛盾或需要更强判断，再按需 Fetch/打开原页，更新核对标记。
7. 点击结果进入真实浏览器页面；抓取失败不阻止用户打开原页。
8. 用户修改查询时取消旧请求，保留已显示内容到新结果可用。

Search API 与模型 API 是两个独立接口。模型内建搜索可能不给出稳定、完整的结果列表，不能替代用户需要的搜索页。DeepSeek Search/Fetch 是首个适配器，至少另备一个合法可用的检索源，并保留普通网页搜索回退。[DeepSeek Search/Fetch 文档](https://api-docs.deepseek.com/guides/search/)

### 4.2 首次使用与部署

首启不要求用户申请第三方 key。提供一个开源、可自托管的默认检索/总结服务，用项目持有的服务器端凭据提供有限的免登录体验；公开提交的查询会发往何处、日志保留与删除规则。服务需有滥用防护和可观测性，但不得记录原始浏览历史。用户可一键改用自带 key、自己的服务或本地模型。默认服务故障时，普通浏览器导航与已配置的搜索提供者继续可用。

这项服务的运行成本是开放项目的真实基础设施负担；不把费用转嫁成首次安装的配置劳动，也不假设公共服务可以无限制免费开放。M2 发布前须拿出可持续的运营和降级方案。

### 4.3 搜索评价

建立含中文、英文、时效性、歧义、站点限定、相互冲突来源、抓取失败的标注集。测量结果相关性、覆盖、重复、来源多样性、首次可用结果时间、总结可追溯性和用户完成任务时间。结果展示与总结分别测，不能用 LLM 自评替代人工标注。

---

## 5. AI 最大兼容：统一能力，不假装接口相同

### 5.1 两类独立适配

- **ModelProvider**：OpenAI、Claude、Gemini、DeepSeek、本地 llama.cpp/Ollama 及兼容端点；负责鉴权、流式协议、工具调用、结构化输出、多模态、错误与能力声明。
- **SearchProvider**：DeepSeek Search/Fetch 和其他检索服务；负责排名结果和原页内容。模型可换，搜索结果仍保留；搜索可换，浏览器页面仍可用。

内部只暴露 Grid 的任务与工具语义。每个适配器把本地标准事件映射到厂商原生 API；不把所有厂商强塞到一个“OpenAI 兼容”实现。比如 DeepSeek 的 Responses 兼容文档明确列出不支持及静默忽略的参数，必须靠能力合约和测试发现。[DeepSeek Responses 兼容说明](https://api-docs.deepseek.com/guides/responses_api/)

### 5.2 能力合约测试

每个适配器必须通过：纯文本、流式取消、JSON schema、单工具与多工具、错误重试、超时、内容超限、模型版本变化、隐私边界。缺少能力时，UI 应降级为已支持路径或提示用户换模型；不能伪装成功。提供统一的测试夹具和供应商版本矩阵。

OpenAI 官方文档描述 Responses 的工具调用；Claude 使用 Messages 的工具调用；Gemini 当前推荐 Interactions API；本地 llama.cpp 提供兼容服务器但也明确不能保证完全一致。版本矩阵必须持续更新。[OpenAI Docs：函数工具](https://developers.openai.com/api/docs/guides/function-calling)、[Claude 工具文档](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)、[Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview)、[llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)

### 5.3 模型选择的用户体验

默认使用项目提供的可用模型能力；设置页只保留“默认”“本地”“自定义服务”三级入口。首次用 AI 时清楚说明会发送什么页面内容给哪个服务。高级用户可设多个适配器和任务规则，但主界面不要求用户选模型、上下文长度或协议。

---

## 6. Agent：浏览器执行权永远不交给模型

### 6.1 最小工具面

外部 MCP 与内置模型共用一套浏览器能力，不各写一套动作逻辑：

- tabs.list / tabs.open：列出或打开用户允许的标签；
- page.snapshot：返回选定页面的可访问性与必要 DOM 摘要；
- page.find：按文本或语义定位元素，返回绑定 documentId 的引用；
- page.act：执行 click、type、scroll、select 等动作，并返回可观察后置状态；
- task.status / task.cancel：读取、取消与接管任务；
- evidence.capture：在用户要求时保存来源与快照。

工具不接受任意脚本执行作为常规动作。页面能提供 WebMCP 工具时可受限使用；WebMCP 仍处早期预览，不能作为唯一入口。页面无可靠语义节点时可用截图视觉回退，但应显示给用户并降低自动执行范围。[Chrome WebMCP 状态](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp)

### 6.2 动作闭环

    用户授权 → Broker 规划 → Browser Service 校验
             → 读取当前页面 revision → 执行动作
             → 观察后置条件 → 记录结果 → 返回 Broker/UI

Browser Service 对每次写动作核验 origin、verb、taskId、文档版本、预期 revision、租约栅栏与必要的人类确认。人类输入立即提高栅栏，旧动作在下一道闸门失效。跨导航必须重新定位，不能复用旧 ref。提交后若没有确定结果，标记 unknown 并只读对账，不能再点一次。用户始终可暂停、撤销授权或接管标签。

网页、搜索摘要与 WebMCP 描述视为不可信；它们可以提供事实或操作目标，不能改变权限。Chrome 的官方浏览器 Agent 安全建议明确讨论恶意工具描述、污染输出和跨来源越权风险。[Chrome Agent 安全建议](https://developer.chrome.com/docs/agents/security)

### 6.3 MCP 与浏览器状态

支持当前 MCP 规范并对老客户端做兼容协商。MCP 新版是无会话传输；Grid 的任务和标签状态仍由浏览器本地维护，通过显式 taskId、tabId 和短时授权句柄连接请求。MCP server 默认关闭，仅在用户启用时监听本机，验证 Host/Origin、认证、最小授权与速率限制。现有静态 serve 监听 0.0.0.0，不能复用为持有 API key 或真实浏览器权限的服务。[MCP 2026 规范](https://blog.modelcontextprotocol.io/posts/2026-07-28/)、[MCP 本地服务防护](https://py.sdk.modelcontextprotocol.io/run/deploy/)

### 6.4 适配次序

先用浏览器内部 API 完成导航、标签、输入和权限；再用页面语义树/DOM 做定位；CDP 和 WebDriver BiDi 为测试与外部兼容路径。WebDriver BiDi 仍是 W3C 工作草案，应跟进而不把它当成唯一底层接口。[W3C WebDriver BiDi](https://www.w3.org/TR/webdriver-bidi/)

---

## 7. 证据能力的位置

日常搜索与浏览无需生成 .lattice。用户点“核对这一句”时显示来源、抓取时间、原句和核验状态；点“保存/分享核验材料”时才生成文件。

现有 lattice/、Web 验证器和 Python 验证器作为 Evidence 组件起点。进入浏览器前必须：
- 统一 SPEC.md 与四端签名范围、版本和测试；
- 区分哈希完整性、原句锚点、语义支持、来源真实性和签发者身份；
- 处理 Fetch 覆盖缺口：浏览器原页可阅读，不能冒充已保存的快照；
- 设计快照保留、删除和用户隐私规则。

这些修复是格式正确性工作，不应阻塞 M1/M2 的正常浏览和搜索主线。

---

## 8. 平台与生态适配

### 8.1 桌面平台

先在 macOS 验证端到端体验，同时在 CI 中尽早构建 Windows 与 Linux，避免平台抽象在后期才出现。平台差异集中在 secure storage、安装与自动更新、系统代理、通知、文件选择器、默认浏览器注册和辅助技术接口。跨平台共享搜索、模型、Agent、证据的契约和测试夹具。

### 8.2 扩展与数据迁移

测试主流 MV3 扩展的安装、权限与运行；具体分发来源及商店兼容单独核对。提供从现有浏览器导入书签、历史、密码的安全流程，以及可导出的开放格式。扩展 API、密码迁移和同步不能简单假定“继承 Chromium 就自动完成”。[Chrome MV3 官方资料](https://developer.chrome.com/docs/extensions/develop/migrate)

### 8.3 移动端

桌面首发，不把桌面 Chromium 代码直接承诺为移动产品。Android 与 iOS 的内核、系统权限、分发规则和触控交互分别调研；保持数据格式与用户意图模型可移植。移动适配须独立通过任务体验与安全门槛。

### 8.4 本地化与无障碍

中文和英文同时作为首批测试语言；地址栏、搜索输入、快捷键、焦点、屏幕阅读器、缩放与高对比度从第一版进入回归。新增 AI 入口不能破坏标准浏览器键盘路径。

---

## 9. 代码组织与现有资产迁移

建议仓库结构（可用独立仓库或 monorepo；先按组件边界组织）：

    browser/             Chromium pin、薄补丁、Browser Service、Mojo
    ui/                  WebUI：新标签、搜索结果、按需任务/比较
    ai-broker/           Rust：任务编排、模型/检索适配、MCP
    protocol/            版本化 schema、跨语言生成类型、合约测试
    evidence/            .lattice 规范与验证器
    relay/               开源默认服务，可自托管
    tests/               用户任务、兼容、性能与安全测试
    docs/                架构、ADR、构建、贡献、安全政策

旧研究工作区中的 `.lattice` CLI 与验证器暂不纳入首批公开仓库；先核对许可、测试夹具、签名范围和演示材料，再为 SearchProvider、ModelProvider、EvidenceVerifier 加合约测试并按模块迁移。旧 AppKit 阅读原型只保留为原生阅读实验；旧 `gateway.mjs` 作为状态机参考，真实页面权限闸门重新在 Browser Service 落地。每次迁移要能指出用户体验收益和回归测试。

上游 Chromium 不直接复制进普通 Git 历史；固定版本、记录补丁及构建参数，自动生成补丁差异报告。尽量把业务逻辑放在独立组件，减少每次上游更新冲突。

---

## 10. 分阶段落地与严格验收

每一阶段的出口同时要求产品演示、自动测试与可复现构建。阶段次序与 PLAN.md M0–M6 对齐。

| 阶段 | 依赖 | 交付 | 不能宣称完成的情况 |
|---|---|---|---|
| T0：任务基线与原型 | 无 | 真实任务集、现有浏览器基线、输入/结果/原页交互原型、G1 内核测试 | 只有静态图、内部自评或单一 PoC |
| T1：浏览器骨架 | T0 | Chromium 构建与安装、地址栏、标签、导航、历史、登录、下载、权限、崩溃恢复、数据导入、自动更新通路 | 仍需回到原浏览器完成常用操作 |
| T2：搜索闭环 | T1 | Search adapters、短总结与结果列表、默认免 key 体验、原页返回、失败回退 | 结果被总结阻塞或用户无法打开来源 |
| T3：意图连续性 | T2 | 跨页面上下文、比较、恢复任务、无需手动建空间 | 多标签任务仍需重复搜索和复制粘贴 |
| T4：AI 兼容与 Agent | T1–T3 | Model capability matrix、真实页面动作、授权/接管、MCP、恶意页面测试 | 只在 mock executor 或单一模型上通过 |
| T5：按需证据 | T2–T4 | 就地核对、修正后的 .lattice、四端互操作 | 把锚点命中当成语义正确 |
| T6：开放发布 | T1–T5 | 三平台发布矩阵、构建说明、许可、贡献、安全响应、可用安装包、30 秒体验入口 | 外部人无法安装、复现或报告问题 |

### 10.1 最小可公开体验

“开源浏览器的第一个可体验版本”至少应做到：无需申请 key 即可安装、正常浏览真实网站、搜索显示结果和短总结、打开原页并返回、AI 失败时浏览不受影响、反馈入口明确。Agent 与 .lattice 可在后续版本逐步开放，但不能以缺失浏览器基本功换取过早展示。

### 10.2 工程门槛

- 安全：站点隔离与沙箱不降级；上游 stable 安全更新有自动监测、补丁回归和紧急发布机制。目标是安全更新延迟以天计，实际数值公开披露。
- 可靠：浏览器崩溃恢复、标签恢复、搜索中断、模型中断、网络断开、Agent 中断都有测试。
- 性能：同设备同网页测冷启动、输入响应、首个可用搜索结果、P50/P95 任务时间、完整进程树内存与能耗；先立基线再定优化目标。
- 隐私：遥测默认最小化，浏览记录不上传；用户可查看并删除任务数据、缓存与证据。
- 兼容：常用网站、登录、上传下载、中文输入法、PDF/视频、辅助技术与选定扩展形成固定回归集。

---

## 11. 发布与开源采用

技术第一还要可体验、可审查、可持续维护：

1. 决定与 Chromium、第三方依赖相容的开放许可证，公开 SBOM、构建说明、二进制签名和校验方法。
2. 建立 nightly、beta、stable 通道；上游更新合并、跨平台构建、浏览器回归与安全测试自动化。公开当前跟踪的 Chromium 版本与安全更新延迟。
3. 保持源码与可安装版本一致，避免“代码开源但用户运行的是另一套不可复现构建”。
4. 发布真实任务演示：从输入问题到短总结、结果、原页、按需 AI 帮忙；同时公开失败场景。
5. 用用户任务完成率、留存、兼容、崩溃、安全更新、外部贡献者与集成质量衡量进展。仓库星数只是辅助。

已有 BrowserOS 是带 AI Agent 的开源 Chromium fork，因此“内置 AI”本身并不构成领先。Grid 的可验证差异应是：更少配置、更清楚的搜索结果、更完整的日常浏览、更多模型与 Agent 可接入、始终可控的真实页面操作。[BrowserOS 项目说明](https://github.com/browseros-ai/BrowserOS/blob/main/README.BrowserOS.md)

---

## 12. 风险与决策门

| 风险 | 决策门或处理 |
|---|---|
| Chromium fork 更新跟不上 | G1：先完成自动跟踪、构建和安全回归；做不到不能公开作为日常浏览器 |
| 界面因 AI 变复杂 | 每个新增 UI 在真实任务测试中证明必要；默认界面保持地址栏、结果、网页 |
| AI 适配名义兼容、能力实际缺失 | 能力矩阵 + 供应商原生接口合约测试 + 明确降级 |
| 默认服务被滥用或停服 | 免 key 服务有滥用控制、隐私说明与自托管/BYOK 回退；浏览本体不依赖它 |
| Agent 被网页注入操纵 | 页面数据不授予权限；主进程闸门、来源限制、敏感动作人工确认、恶意页面测试 |
| 双内核造成登录态分裂 | 默认单内核；任何双内核方案必须证明资料档、历史、权限和 Agent 一致性 |
| .lattice 的验证结论被误读 | UI 和格式分层呈现完整性、锚点、语义支持、来源真实性与身份 |
| 项目追求“第一”导致功能膨胀 | 以用户任务与开放采用为判断，不以功能数量为指标 |

---

## 13. 第一批具体工作包

1. **任务基线**：把 PLAN.md M0 的 20–30 个任务做成可复跑脚本与用户测试表。
2. **Chromium 构建实验**：固定 stable 版本，macOS 首建，CI 建 Windows/Linux；测原生浏览器基础流程与上游更新速度。
3. **WebUI 垂直切片**：一个地址栏、一个搜索结果页、一个真实网页；结果先行、短总结异步、可返回原查询。
4. **协议与适配**：冻结 SearchHit、IntentContext、PageHandle、ModelCapabilities 等 schema；为 DeepSeek 和第二检索源做合约测试；修正旧模型名。
5. **免 key 体验**：实现开源 relay 的最小可用版本、隐私文案、自托管与 BYOK 回退，验证外部用户可安装试用。
6. **真实页面动作实验**：只读 snapshot → 安全点击/输入 → 人类接管 → 失败对账；先覆盖两个动态、一个登录网站。
7. **证据修复**：修正 SPEC 签名范围及四端一致性，把证据核对放进按需入口。

这七个工作包形成一条纵向闭环：真实用户任务 → 可用浏览器 → 搜索结果 → 真实网页 → 可选 AI 动作 → 可选证据。任何工作包都不能只以“代码已写”验收。

---

## 14. 一手资料与核对日期

截至 2026-10-30：
- [Chromium 架构](https://www.chromium.org/developers/design-documents/multi-process-architecture/)、[跨平台构建](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/get_the_code.md)、[WebUI 与 Mojo](https://chromium.googlesource.com/chromium/src/+/main/docs/webui/webui_explainer.md)、[安全更新](https://chromium.googlesource.com/chromium/src/+/main/docs/security/updates.md)。
- [DeepSeek Search/Fetch](https://api-docs.deepseek.com/guides/search/)、[DeepSeek Responses 兼容范围](https://api-docs.deepseek.com/guides/responses_api/)。
- [OpenAI Docs：工具调用](https://developers.openai.com/api/docs/guides/function-calling)、[Claude 工具调用](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)、[Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview)、[llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)。
- [MCP 2026 规范](https://blog.modelcontextprotocol.io/posts/2026-07-28/)、[WebDriver BiDi 草案](https://www.w3.org/TR/webdriver-bidi/)、[WebMCP 预览](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp)、[Chrome Agent 安全](https://developer.chrome.com/docs/agents/security)。
- [BrowserOS 开源项目](https://github.com/browseros-ai/BrowserOS/blob/main/README.BrowserOS.md)。

一手资料证明接口、实现或发布状态；“这条路线会成为第一”的判断仍须由产品对照、兼容、安全和社区采用实测支持。
