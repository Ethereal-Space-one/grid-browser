# Grid 技术方案与实施路线（v1.4.1）

> 2026-11-02。配套主文件：[PLAN.md](./PLAN.md)。本文件回答“如何把意图优先的开源浏览器做出来”，不改变 PLAN.md 的产品目标。Grid 是当前产品名，早期计划使用 Lattice 开发代号。
> 状态：实施方案。技术选型中标为“候选”的内容须经过对应决策门验证；本文不把 PoC 当成已完成的浏览器。

---

## 0. 永不偏离的产品约束

用户打开 Grid，是为了**自己决定要做什么，在少受推荐流牵引的入口查找与阅读，并可控地完成网页操作**。每一项技术能力都必须通过以下问题：

1. 它是否减少了从意图到可用结果、原页或完成动作的时间与认知负担？
2. 它是否保留用户对方向、页面、登录态和 Agent 动作的控制？
3. 没有 AI、模型故障或网络受限时，浏览器是否仍能正常使用？
4. 它能否被外部用户独立安装、复现、检查和贡献？

第一屏只有标准浏览器输入入口；搜索页是短总结加结果列表；阅读视图保留 A（真实原页）与 B（Fetch 正文优先）两条待选路线；Agent、比较、证据按需出现。浏览器被 Agent 使用时，控制预览与暂停入口始终可信且易见。不得为了展示技术而增加常驻侧栏、模式选择、强制会话、证书流程或配置向导。

---

## 1. 从用户动作反推系统

| 用户动作 | 用户看到 | 系统必须做 | 验收 |
|---|---|---|---|
| 输入网址 | 立即进入真实网页 | 本地识别网址，走浏览器导航；不调用模型 | 不把网址误送检索；前进后退、登录与下载正常 |
| 输入查询 | 上方简短总结、下方可直接打开的结果 | 并行取得结果、异步总结；结果不等模型 | 无模型时仍有结果；首屏不被总结遮住 |
| 打开结果 | A 为真实原页；B 为带来源/抓取时间的干净正文及原页入口 | 保留查询和返回路径；B 抓取失败立即回退原页 | 两路线可同任务比较；B 不冒充原页或已核对事实 |
| 比较页面 | 两页及其与原问题的关系 | 读取用户选定的页面，保留来源与位置 | 不自动读取其他标签或私密页面 |
| 请求 AI 帮忙 | 授权范围、过程、暂停和接管 | 由浏览器发能力授权，执行可观察动作 | 人类输入抢占；未知结果不重试写操作 |
| 连接外部 Agent | 当前会话的受限连接、客户端身份与范围 | 通过本机受控桥接共用内部能力面，不复制 Cookie 或另建浏览器资料档 | 少量步骤可接入；撤销后旧调用立刻失效 |
| 预览下一操作 | 可信浏览器界面中的来源、目标、输入摘要与影响 | 将预览绑定页面版本和授权；执行时在原页显示真实进度 | 目标变化后预览失效；用户能暂停或接管 |
| 核对或分享 | 原句、来源、抓取时间、可选文件 | 生成快照和 .lattice，分别标明各类保证 | 不把“引文存在”写成“结论正确” |

这张表是工程排期的依赖图：没有真实网页与正常导航，就不能宣称完成搜索体验；没有可验证的授权与真实页面操作，就不能宣称 Agent 可用；没有准确的证据语义，就不能宣称答案可审计。

---

## 2. 总体架构

**M0 原型**：采用 Electron 外壳及其打包的 Chromium，用受限 CDP 连接 Search/Fetch、A/B 阅读视图和可见、可接管的 Agent 操作。本机 stdio/MCP 桥接与应用编排先用 TypeScript/Node 一种语言实现，隔离资料档与测试权限。此原型只能验证用户是否觉得流程有用，不能证明浏览器主进程动作闸门与可信预览安全模型。下图仅是 M0 通过、独立 fork ADR 获批后的候选架构。

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
                                                              └─ MCP 接入（本机 stdio 桥接；HTTP 可选）

边界定义：

- **浏览器进程是唯一权威**：页面、资料档、Cookie、下载、站点权限、动作授权与人类抢占的最终裁决都在这里。模型进程不能直接读 Cookie 数据库、调用任意浏览器内部 API 或绕过动作闸门。
- **网页渲染进程不可信**：页面文字、DOM、WebMCP 描述和工具输出都是数据，不会成为用户指令。
- **AI Broker 可替换**：崩溃、断网或没有模型时，浏览器本体继续工作。它只通过受限 IPC 读取获授权的页面信息，提出动作请求；Browser Service 再验证并执行。
- **WebUI 是产品界面，不是网页内容**：搜索与任务 UI 使用独立内部来源，界面到浏览器服务用有类型的 Mojo 接口。每个新增接口写明权限、调用方与失败方式。Chromium 官方把 WebUI、TypeScript 与 Mojo 作为现成路径。[Chromium WebUI 说明](https://chromium.googlesource.com/chromium/src/+/main/docs/webui/webui_explainer.md)

### 2.1 推荐技术栈

| 层 | M0 或后续候选 | 理由与限制 |
|---|---|---|
| 原型浏览器 | Electron 外壳 + 打包的 Chromium + 受限 CDP；TypeScript/Node | 三平台复用一份应用代码的假设待 CI 验证；先测核心动线，实验资料档与权限隔离不代表日用浏览器安全性 |
| 独立浏览器候选 | 跟踪 Chromium stable 的薄补丁 fork，C++ | 仅在独立 ADR 证明必要性、维护团队及安全更新能力后进入实施 |
| 媒体与网页平台 | Chromium 媒体管线、系统音视频设备与浏览器权限 | 以实际 Grid 安装包验证编解码、MSE、EME/CDM、硬件回退、WebRTC 和系统集成；逐项记录许可与分发限制 |
| 独立浏览器窗口候选 | Chromium 原生 UI/Views，最少改动 | fork ADR 通过后保留惯用导航与无障碍行为，降低 patch 面积 |
| 搜索/任务页面 | M0 用 TypeScript 原型；fork 后候选 WebUI + Lit/Mojo | 先验证用户动线；不在原型期建设跨进程 UI 协议 |
| Agent 控制预览 | 浏览器可信 UI + 页面目标高亮 | 授权和操作摘要由浏览器绘制；页面只提供目标数据，不能伪造控制界面 |
| AI Broker（后续候选） | 独立 Rust 进程，版本化 IPC | 仅在独立浏览器 ADR 后评估；M0 复用最小适配逻辑，不并建完整 Broker |
| 本地状态 | 浏览器资料档 + SQLite/内容寻址文件 | 任务元数据、来源与缓存分开；密钥使用系统安全存储 |
| 扩展入口 | MV3 兼容性测试 + 外部 MCP | 扩展是浏览器兼容问题；MCP 是 Agent 接入问题，二者不能混为一谈 |

Rust Broker 是后期候选，不是 M0 前置条件或安全性的替代品。进程边界、IPC 输入校验、浏览器主进程闸门和权限撤销都必须实际实现。历史 lattice Node CLI 仅作后续证据模块的参考，不把它直接当作拥有浏览器权限的常驻服务。

若独立浏览器路线通过 ADR，Browser Service 才启动并监管 Broker；两者可采用版本化 Protobuf 消息，经操作系统本机管道通信（macOS/Linux 为 Unix domain socket，Windows 为 named pipe）。通道需校验对端进程身份、请求大小和授权令牌，不开放为可被网页访问的本地 HTTP 服务。协议升级支持能力协商和旧版拒绝，避免浏览器与 Broker 版本错配后静默越权。

### 2.2 内核决策门 G1

G1 先判定产品链路是否值得独立浏览器实现：M0 用 Electron 外壳、打包的 Chromium 与受限 CDP，验证“搜索结果 → A/B 阅读或原页 → Agent 可见、可暂停、可接管地操作”，与开发者惯用浏览器同任务对照。Swift/WebKit 样机冻结，仅作历史对照，不再扩展。Tauri 在 macOS 使用系统 WKWebView，按当前目标会重遇现有样机的自动化与生态限制；这是路线判断，具体能力缺口仍待同任务实测。[Tauri WebView 版本说明](https://v2.tauri.app/reference/webview-versions/) Electron 的精确版本、安全更新节奏及平台限制**待核对官方资料**；原型不得把 CDP 暴露给网页或公网，并须遵守隔离、沙箱、权限与 IPC 检查。[Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security) 通过用户价值门后才比较继续使用独立壳与 Chromium fork；fork 需单独 ADR，证明团队规模、上游自动合并、跨平台构建/回归、安全更新演练及同负载收益。Electron 内存和启动速度不作为原型成功指标，正式路线决策仍同负载测试。基础能力矩阵见 [浏览器基建矩阵](./docs/BROWSER_FOUNDATIONS.md)。

Chromium 上游已采用频繁 stable 更新及每周安全刷新；Grid 的 fork 若不能跟进，就不具备公开浏览器的安全基础。[Chromium 发布周期](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/process/release_cycle.md)、[安全更新说明](https://chromium.googlesource.com/chromium/src/+/main/docs/security/updates.md)

### 2.3 把交互设计落实为界面状态

| 界面 | 默认信息层级 | 关键状态 | 工程验收 |
|---|---|---|---|
| 新标签与地址栏 | 输入入口、最近任务的轻量恢复入口 | 空白、输入中、网址/查询意图不确定 | 键盘直达、输入法不触发误提交、网址不经模型 |
| 搜索页 | 查询、固定高度的短总结槽、可点结果列表 | 检索中、已有结果、总结中、仅结果、无结果、部分来源失败 | 结果先出现；总结不造成布局跳动；结果始终可打开 |
| 阅读视图（A/B 待决） | 原页或带来源/时间的干净正文；均有回到结果与打开原页入口 | 加载、已抓取、抓取失败、内容不完整、返回原页 | B 不注入原页脚本；写操作在原页重新定位并授权 |
| 真实网页 | 标准导航与网页内容 | 加载、登录、权限请求、下载、崩溃恢复 | 用户像普通浏览器一样完成常用网站任务 |
| 比较/任务面板 | 仅在用户请求后出现，紧邻当前两页或动作 | 选页、授权、进行中、暂停、未知结果、接管 | 来源和下一步可见；Esc/关闭不丢页面状态 |
| Agent 控制预览 | 目标高亮、动作摘要、可信来源和暂停入口 | 待执行、需确认、执行中、已观察、未知结果、过期 | 预览不冒充执行结果；页面变化后失效；人类操作可抢占 |
| 核对入口 | 原句、来源、抓取时间、验证范围 | 未抓取、已锚定、语义待核、身份未验 | 不用一个“通过”混合不同保证 |

设计系统先定义间距、字体、颜色、焦点、加载与错误组件的 token；以 Chromium 原生控件行为为基准。未来感来自精确排版、稳定网格、克制的强调色与状态反馈；命令面板、动作记录和协议状态只在需要时展开。搜索页在常见窗口宽度、缩放比例、浅色/深色、高对比度下保留结果首屏；控制预览同时提供视觉高亮与可读文字，支持键盘和减少动态效果设置。每个交互原型都通过真实任务、键盘和屏幕阅读器验收后再固化为组件；不以视觉稿代替使用证据。

---

## 3. 内部契约：让模块真正可替换

M0 先定义最小的搜索、页面与动作状态契约，避免 UI 依赖供应商字段名或 Agent 依赖页面坐标。跨语言 schema 及 Rust/C++/TypeScript 类型生成在独立浏览器路线获批后实施。

### 3.1 核心对象

- **IntentContext**：id、原始输入、用户确认过的目标、创建时间、关联的标签与查询、状态。每次搜索自动生成；用户不需要手动创建“空间”。
- **SearchHit**：规范化 URL、标题、摘要、来源、检索时间、发布日期（可空）、来源提供者、提供者原始顺序/分数、Grid 展示顺序与解释字段；不暗中使用画像或参与度排序。
- **PageHandle**：profileId、tabId、documentId、navigationId、origin、revision。导航后 documentId 改变，旧节点引用全部失效。
- **ModelCapabilities**：文字、图片、流式、工具调用、结构化输出、最大上下文、服务端状态等能力及约束。能力由适配器显式声明并通过合约测试验证。
- **AgentGrant**：taskId、允许的 origin、动作 verbs、敏感数据范围、到期时间、用户确认状态。授权可撤销，默认最小范围。
- **AgentConnection**：客户端身份、连接方式、已授权 profile/tab/origin、能力版本、到期时间与撤销状态；与模型适配器分开，不能因连接成功而默认获得全部标签。
- **ActionPreview**：taskId、PageHandle、目标引用与可读名称、动作 verb、输入摘要或遮蔽值、副作用等级、预期观察条件、有效期。预览是待执行提案，不是执行结果；页面 revision 或授权变化后必须失效。
- **ActionRequest/Result**：taskId、page handle、预期 revision、操作、目标、幂等键、副作用类别；结果为 succeeded、failed、cancelled 或 unknown，并附可观察证据。
- **EvidenceRecord**：页面 URL、抓取方式、抓取时间、内容哈希、引文位置、可选签名身份；不能把内容哈希解释成来源真实性。

### 3.2 事件与状态

搜索、导航、页面读取、Agent 连接、预览、授权、动作执行、人类接管与证据抓取使用同一条本地事件序列。预览状态依次为待定位、可预览、需确认、执行中、已观察或结果未知；界面从事件中恢复任务进度，动作闸门检查当前文档、权限和栅栏。日志只记录必要元数据，默认不记录网页正文、密码或完整提示词；输入字段在预览和日志中按敏感性遮蔽。浏览器崩溃后能恢复标签与未完成任务，但未知写动作只能进入人工核对。

### 3.3 失败契约

每层都返回结构化错误：无结果、网络超时、抓取被拒、模型不支持所需能力、模型中断、页面已导航、预览过期、连接或授权失效、人类已接管、动作后置条件未知。UI 显示已有结果和下一步；不能把所有错误归并为“请重试”。

---

## 4. 搜索：先让结果可用，再让 AI 增强

### 4.1 数据流

1. 输入分类：网址直达；查询进入 Search；明确的操作请求才进入任务规划。
2. 查询标准化：保留用户原话，必要时生成至多少量改写，不能暗中改变搜索目标。
3. Search adapters 并行返回结果；去重并保留各来源信息，不使用未经测量的统一硬阈值。
4. 结果列表先渲染，标题、URL、摘要和可用日期立刻可点。
5. Model adapter 根据已返回的摘要生成两三句方向性总结；总结槽位置固定，不让页面跳动。
6. 若摘要不足、来源互相矛盾或需要更强判断，再按需 Fetch/打开原页，更新核对标记。
7. A 路线点击结果进入真实原页；B 路线先展示带来源与抓取时间的干净正文，交互时回到真实原页；抓取失败不阻止打开原页。两条路线待用户选择。
8. 用户修改查询时取消旧请求，保留已显示内容到新结果可用。

Search API 与模型 API 是两个独立接口。模型内建搜索可能不给出稳定、完整的结果列表，不能替代用户需要的搜索页。DeepSeek Search/Fetch 是首个适配器，至少另备一个合法可用的检索源，并保留普通网页搜索回退。[DeepSeek Search/Fetch 文档](https://api-docs.deepseek.com/guides/search/)

**待核对的分发边界**：官方 Search 文档将 `snippet` 描述为供 UI 展示；这不足以直接确认结果列表展示、缓存期限、Fetch 正文保存或再分发、摘要引用第三方内容的权利。先核对 Search/Fetch 专项规则、开放平台条款和来源站点政策，再确定公开版能力；未得结论时标“待核对”。[Search/Fetch 文档](https://api-docs.deepseek.com/guides/search/)、[开放平台条款](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)

历史 PoC 的 Fetch 约四分之一失败来自一次样本，不是可外推的故障率。按站点类型、动态性和拒绝原因重测，记录 Fetch 成功率、第二获取路径与一键原页回退；B 路线以此作为核心决策门，A 路线也不得把未抓取页面标成已核对。

### 4.2 首次使用与部署

原型检索默认由开发者配置自带 key 或自己的检索服务；总结/推理可使用自带 key 或本地模型。仅配置本地模型并不会产生搜索结果，界面应提示仍需检索源，并保持网址直达可用。提供短而可复制的接入步骤；密钥只在受控本地进程存储，不进入网页。免 key relay 降为后续候选，不是 T0/T2 的前置条件。若未来采用项目服务器，用户查询会经过该服务器及下游提供者；这与低监控目标存在张力。上线前须公开实际处理的查询/IP/元数据、日志策略、保留期限、删除方式、下游去向、滥用防护和完整自托管方法；未定参数标“待决定”。relay 故障时，普通浏览器导航与已配置的搜索提供者仍应可用。

若以后提供公共 relay，其运行成本是开放项目的真实基础设施负担；需另行制定可持续的运营和降级方案。M2 以前不以 relay 或免 key 为验收条件。

### 4.3 搜索评价

建立含中文、英文、时效性、歧义、站点限定、相互冲突来源、抓取失败的标注集。测量结果相关性、覆盖、重复、来源多样性、首次可用结果时间、总结可追溯性和用户完成任务时间。记录提供者原顺序、Grid 重排、查询改写和广告位审计；A/B 用同任务比较干扰、阅读成功及 Fetch 失败恢复。结果展示与总结分别测，不能用 LLM 自评替代人工标注。

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

本节描述目标安全约束。M0 的 Electron/CDP 实验壳只在隔离资料档和受限测试站点验证体验，不宣称已有 Browser Service 级权限闸门或可信预览；发布级能力仍需在最终内核方案上单独实现并测试。

### 6.1 最小工具面

外部 MCP 与内置模型共用一套浏览器能力，不各写一套动作逻辑：

- tabs.list / tabs.open：列出或打开用户允许的标签；
- page.snapshot：返回选定页面的可访问性与必要 DOM 摘要；
- page.find：按文本或语义定位元素，返回绑定 documentId 的引用；
- page.prepare：定位下一动作，返回绑定当前页面版本的 ActionPreview；
- page.act：消费有效预览，执行 click、type、scroll、select 等动作，并返回可观察后置状态；
- task.status / task.pause / task.cancel：读取、暂停、取消与接管任务；
- evidence.capture：在用户要求时保存来源与快照。

工具不接受任意脚本执行作为常规动作。页面能提供 WebMCP 工具时可受限使用；WebMCP 仍处早期预览，不能作为唯一入口。页面无可靠语义节点时可用截图视觉回退，但应显示给用户并降低自动执行范围。[Chrome WebMCP 状态](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp)

### 6.2 动作闭环

    用户授权 → Broker 规划 → Browser Service 定位并生成预览
             → 校验当前页面 revision/授权 → 必要时人类确认 → 执行动作
             → 观察后置条件 → 记录结果 → 返回 Broker/UI

Browser Service 对每次写动作核验 origin、verb、taskId、文档版本、预期 revision、预览有效期、租约栅栏与必要的人类确认。预览句柄不能代替授权；人类输入立即提高栅栏，旧动作在下一道闸门失效。跨导航必须重新定位，不能复用旧 ref 或旧预览。提交后若没有确定结果，标记 unknown 并只读对账，不能再点一次。用户始终可暂停、撤销授权或接管标签。

网页、搜索摘要与 WebMCP 描述视为不可信；它们可以提供事实或操作目标，不能改变权限。Chrome 的官方浏览器 Agent 安全建议明确讨论恶意工具描述、污染输出和跨来源越权风险。[Chrome Agent 安全建议](https://developer.chrome.com/docs/agents/security)

### 6.3 可信预览与实时控制

预览由 Browser Service 根据用户允许的当前标签生成，可信浏览器 UI 显示站点来源、目标名称与位置、拟输入内容摘要、动作影响及确认要求；密码、令牌和敏感字段仅显示遮蔽值。页面中的高亮只辅助定位，不能承载授权或覆盖站点安全提示。若 DOM、导航、焦点或权限变化使目标不再确定，预览失效，Agent 重新定位；绝不复用旧坐标盲点。

执行时先出现简短的待执行状态，随后在真实网页中显示实际动作与可观察回执。轻量控制条提供暂停、继续、接管和停止；详细动作记录按需展开。普通动作的预览以可扫读的轻量状态呈现，可在已授权范围内连续执行；敏感或不可逆动作逐项确认。预览不模拟网页提交后的成功画面；后置状态无法确认时显示 unknown 与人工核对入口。键盘和屏幕阅读器可完成全部控制。

### 6.4 外部 Agent 接入与浏览器状态

M0/M1 即提供本机 `stdio`/MCP 桥接，让常用 AI 编程工具在几步内读取获授权页面，并记录首次接入步骤与耗时；M4 再扩展正式动作能力。目标架构中，内置 Agent 与外部客户端共用 Browser Service 的能力和预览闸门：客户端启动桥接，Grid 显示连接者与授权范围，用户选定允许的标签/站点和时间；桥接经已验证的本机 IPC 访问浏览器，不复制 Cookie 或在网页中安装脚本。原型的 Electron 主进程桥接不等于此目标安全边界。提供可复制的客户端配置与连接状态，避免要求用户手工寻找端口或令牌。对于只支持 Streamable HTTP 的客户端，可选择启用 loopback 端点，按需配对、鉴权、校验 Host/Origin 并限制速率；默认不监听。MCP 当前标准传输包括 `stdio` 和 Streamable HTTP。[MCP 传输规范](https://modelcontextprotocol.io/specification/draft/basic/transports)

Grid 的任务和标签状态由浏览器本地维护，通过显式 taskId、tabId、能力版本和短时授权句柄连接请求。撤销授权、关闭标签或人类接管后，旧连接的相关调用即失效。现有静态 serve 监听 0.0.0.0，不能复用为持有 API key 或真实浏览器权限的服务。[MCP 本地服务防护](https://py.sdk.modelcontextprotocol.io/run/deploy/)

### 6.5 适配次序

先用浏览器内部 API 完成导航、标签、输入和权限；再用页面语义树/DOM 做定位；CDP 和 WebDriver BiDi 为测试与外部兼容路径。WebDriver BiDi 仍是 W3C 工作草案，应跟进而不把它当成唯一底层接口。[W3C WebDriver BiDi](https://www.w3.org/TR/webdriver-bidi/)

---

## 7. 证据能力的位置

日常搜索与浏览无需生成 .lattice。用户点“核对这一句”时显示来源、抓取时间、原句和核验状态；点“保存/分享核验材料”时才生成文件。

现有 lattice/、Web 验证器和 Python 验证器作为 Evidence 组件起点。进入浏览器前必须：
- 统一 SPEC.md 与四端签名范围、版本和测试；
- 区分哈希完整性、原句锚点、语义支持、来源真实性和签发者身份；
- 处理 Fetch 覆盖缺口：浏览器原页可阅读，不能冒充已保存的快照；
- 设计快照保留、删除和用户隐私规则。

这些修复是格式正确性工作，不应阻塞 M1/M2 的正常浏览和搜索主线。.lattice 解决可核验引用，与核心的低干扰搜索/阅读和可控 Agent 相邻；可在核心体验稳定或首版发布后独立推进。

---

## 8. 平台与生态适配

### 8.1 桌面平台

开发者优先，首发 macOS；Linux 为第二优先（nightly 或社区支持版本），Windows 正式适配待产品价值验证后启动。原型阶段不承诺三平台稳定发布，但 CI 同时构建 macOS、Linux、Windows，以尽早暴露平台差异；CI 成功不等于安装、兼容和安全验收通过。平台差异集中在 secure storage、安装与自动更新、系统代理、通知、文件选择器、默认浏览器注册和辅助技术接口。跨平台共享搜索、模型、Agent、证据的契约和测试夹具。macOS 分发尽早准备 Apple 开发者账号，并走通一次 Developer ID 签名、公证和安装验证；账号费用及流程细节**待核对官方说明**。[Apple 公证文档](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

### 8.2 扩展与数据迁移

测试主流 MV3 扩展的安装、权限与运行；具体分发来源及商店兼容单独核对。提供从现有浏览器导入书签、历史、密码的安全流程，以及可导出的开放格式。扩展 API、密码迁移和同步不能简单假定“继承 Chromium 就自动完成”。[Chrome MV3 官方资料](https://developer.chrome.com/docs/extensions/develop/migrate)

### 8.3 移动端

桌面首发，不把桌面 Chromium 代码直接承诺为移动产品。Android 与 iOS 的内核、系统权限、分发规则和触控交互分别调研；保持数据格式与用户意图模型可移植。移动适配须独立通过任务体验与安全门槛。

### 8.4 本地化与无障碍

中文和英文同时作为首批测试语言；地址栏、搜索输入、快捷键、焦点、屏幕阅读器、缩放与高对比度从第一版进入回归。新增 AI 入口不能破坏标准浏览器键盘路径。

### 8.5 媒体与日用网页能力

先保障网站自身的播放器在 Grid 中正常工作，再考虑 Grid 自有播放器。媒体层通过 Chromium 的 `<video>`/`<audio>`、MSE、EME/CDM、编解码和系统设备实现；Video.js 10 仅作为将来自有媒体查看器的 UI 候选。若后来采用 Lit WebUI 且确有自有播放器需求，先评估 `@videojs/html`；`@videojs/react` 只用于独立 React 界面。浏览器不替换第三方网站的播放器。[Chromium 媒体目录](https://chromium.googlesource.com/chromium/src/+/HEAD/media/README.md)、[Video.js HTML 安装](https://videojs.org/docs/guides/installation/html)、[Video.js React 安装](https://videojs.org/docs/guides/installation/react)

以实际分发包建立媒体格式/站点矩阵，逐项测字幕、全屏、画中画、后台播放、摄像头/麦克风/共享屏幕、PDF/打印、Passkey、文件往返及离线网页。H.264/AAC、受保护流媒体和 CDM 的打包与授权单独核对；不能把 Chromium 源码可编译视为 Grid 可分发。格式、站点和平台缺口在首个公开版本中可查。[Chromium 编解码说明](https://www.chromium.org/audio-video/)

---

## 9. 代码组织与现有资产迁移

M0 只保留足以跑三项代表任务的技术栈；以下状态指**原型排期**，不等于删除历史源码：

| 资产/技术 | M0 处置 | 理由与恢复条件 |
|---|---|---|
| Electron + 打包的 Chromium、受限 CDP | 保留，M0 唯一产品原型 | TypeScript/Node 单一编排语言；验证 A/B 阅读、真实原页和 Agent 控制的用户价值，不能验证正式安全模型 |
| TypeScript 搜索交互样机与本地任务夹具 | 保留并接入真实结果 | 已有界面和任务基础；替换录制数据时保留失败状态 |
| Swift/WebKit 对照样机 | 冻结，仅留历史对照 | 不再扩展功能；已有实测可供 G1 参考 |
| 旧 Node Search/Fetch 适配 PoC | 仅迁移最小检索契约与夹具 | 用 TypeScript/Node 在 Electron 原型重建必要路径，不整体移植旧 CLI |
| Rust Broker、Chromium C++/Mojo、Protobuf | 推迟决策，冻结实施 | 原型验证后再决定是否引入 Rust；C++/Mojo 仅随正式 fork ADR 评估 |
| 旧 Python/Node .lattice 与四端验证器 | 冻结，仅作后续证据模块参考 | 核心任务通过后再修 SPEC 与互操作；不阻塞 M1/M2 |
| 公共 relay | 后续候选，原型不部署 | 默认自带 key/本地模型；先核对权利、隐私与自托管 |

下列目录是**独立浏览器路线获批后的候选**，不是 M0 必须建立的结构。

独立浏览器若获批，建议按组件边界组织：

    browser/             Chromium pin、薄补丁、Browser Service、Mojo
    ui/                  WebUI：新标签、搜索结果、按需任务/比较
    ai-broker/           Rust：任务编排、模型/检索适配、MCP
    protocol/            版本化 schema、跨语言生成类型、合约测试
    evidence/            .lattice 规范与验证器
    relay/               开源默认服务，可自托管
    tests/               用户任务、兼容、性能与安全测试
    docs/                架构、ADR、构建、贡献、安全政策

旧研究工作区中的 `.lattice` CLI 与验证器暂不纳入原型；核心体验稳定后再核对许可、测试夹具、签名范围和演示材料，并按需迁移。旧 AppKit 阅读原型只保留为阅读实验；旧 `gateway.mjs` 作为状态机参考。若选择独立浏览器，真实页面权限闸门再在 Browser Service 落地。每次迁移要能指出用户体验收益和回归测试。

上游 Chromium 不直接复制进普通 Git 历史；固定版本、记录补丁及构建参数，自动生成补丁差异报告。尽量把业务逻辑放在独立组件，减少每次上游更新冲突。

---

## 10. 分阶段落地与严格验收

每一阶段的出口同时要求产品演示、自动测试与可复现构建。阶段次序与 PLAN.md M0–M6 对齐。

| 阶段 | 依赖 | 交付 | 不能宣称完成的情况 |
|---|---|---|---|
| T0：任务基线与原型 | 无 | macOS 开发者三项代表任务、惯用浏览器基线、Electron/CDP 的搜索 → A/B 阅读 → 原页 → Agent 预览/接管纵向原型；本机 stdio/MCP 只读桥接、首次接入步骤与耗时、JSON 操作回执导出、Fetch 缺口实测及 G1 能力清单 | 只有静态图、内部自评或单一 PoC；无法比较 A/B、来源偏差和接管效果；把原型当作正式安全验证 |
| T1：浏览器路径决策与基础 | T0 | 根据任务证据选继续集成/独立壳/fork；fork 另作 ADR；对应安装包的浏览、媒体、会议、PDF/Passkey/离线能力与安全更新矩阵 | 把原型当正式浏览器；fork 无团队与自动更新演练；常用任务仍须回惯用浏览器 |
| T2：搜索闭环 | T1 | Search adapters、短总结与结果列表；检索用自带 key/自配服务，总结可用本地模型；原页返回、失败回退；relay 后置 | 结果被总结阻塞、用户无法打开来源或原型依赖未核对的公共 relay |
| T3：意图连续性 | T2 | 跨页面上下文、比较、恢复任务、无需手动建空间 | 多标签任务仍需重复搜索和复制粘贴 |
| T4：AI 兼容与 Agent | T1–T3 | Model capability matrix、真实页面动作、最终内核方案上的可信预览与主进程闸门、原页实时状态、暂停/接管、本机 MCP 动作扩展、JSON 操作回执导出、恶意页面测试 | 只在 Electron 原型或 mock executor 上通过；预览和动作脱节或外部 Agent 须复制登录态 |
| T5：按需证据（可后移） | 核心体验稳定 | 就地核对、修正后的 .lattice、四端互操作；不作为首版发布依赖 | 把锚点命中当成语义正确 |
| T6：开放发布 | T1–T4；T5 可并行或后置 | 选定路线的安装/集成包、构建说明、许可、贡献、安全响应、30 秒搜索与受控 Agent 演示；独立浏览器才要求相应平台发布矩阵 | 外部人无法安装、复现或报告问题 |

### 10.1 最小可公开体验

“Grid 的第一个可体验版本”至少应做到：macOS 可独立安装 Electron 实验包，以自带 key/自配检索源显示查询结果，短总结可选本地模型，A/B 阅读均可试用，真实原页可打开并返回，本机 stdio/MCP 桥接能被常用 AI 编程工具在少量步骤内接入获授权页面，Agent 的测试任务可预览和接管，JSON 回执可导出，失败时浏览不受影响，反馈入口明确。T0 原型不代表可日用浏览器；真实 Agent 的广泛网站支持在 T4 通过权限、安全和可靠性门槛后开放。

### 10.2 工程门槛

- 安全：站点隔离与沙箱不降级；上游 stable 安全更新有自动监测、补丁回归和紧急发布机制。目标是安全更新延迟以天计，实际数值公开披露。
- 可靠：浏览器崩溃恢复、标签恢复、搜索中断、模型中断、网络断开、Agent 中断都有测试。
- 性能：原型阶段以同任务完成与操作体验为判断，Electron 内存和冷启动不作为 T0 成功指标；正式路线决策仍在同设备同网页测冷启动、输入响应、首个可用搜索结果、P50/P95 任务时间、完整进程树内存与能耗，先立基线再定优化目标。
- 隐私：遥测默认最小化，浏览记录不上传；用户可查看并删除任务数据、缓存与证据。
- 兼容：常用网站、登录、上传下载、中文输入法、PDF/视频、辅助技术与选定扩展形成固定回归集。
- 媒体与网页平台：以真实 Grid 安装包验证编解码及网站播放、字幕、全屏、画中画、后台音频、会议设备、打印/PDF、Passkey 和离线网页；公布受保护内容与平台差异，追踪硬件回退、掉帧和能耗。
- Agent 控制：从常用 AI 编程工具首次连接、读取授权页、识别目标、暂停及接管的步骤和时间进入任务基线；JSON 回执记录读页、动作、每步依据与结果；正式预览与动作绑定同一页面版本，页面变化后失效；敏感动作逐项确认；键盘与屏幕阅读器可操作；外部连接不复制登录态。

---

## 11. 发布与开源采用

技术第一还要可体验、可审查、可持续维护：

1. 决定与 Chromium、第三方依赖相容的开放许可证，公开 SBOM、构建说明；独立浏览器发布时补充二进制签名和校验方法。
2. 若 fork 获批，建立 nightly、beta、stable 通道；上游更新合并、跨平台构建、浏览器回归与安全测试自动化。公开跟踪的 Chromium 版本与安全更新延迟。
3. 保持源码与可安装版本一致，避免“代码开源但用户运行的是另一套不可复现构建”。
4. 发布真实任务演示：从输入问题到短总结、结果、原页、按需 AI 帮忙；同时公开失败场景。
5. 用用户任务完成率、留存、兼容、崩溃、安全更新、外部贡献者与集成质量衡量进展。仓库星数只是辅助。

已有 BrowserOS 是带 AI Agent 的开源 Chromium fork；其 neo 页面还宣称连接 Codex 等工具并保存可回放会话，因此“内置 AI”“一键 MCP”或“回放”本身不能构成独有叙事。Grid 的待验证组合是：用户查询驱动的低干扰入口、可追溯且可替换的检索、A/B 阅读路线，以及可暂停接管的真实页面操作。2026-11-02 的竞品核对和第 9 项待评估方向见 [PLAN.md §9.1](./PLAN.md#91-竞品核对与待评估方向2026-11-02)。[BrowserOS 项目说明](https://github.com/browseros-ai/BrowserOS/blob/main/README.BrowserOS.md)、[BrowserOS neo](https://browseros.com/)

---

## 12. 风险与决策门

| 风险 | 决策门或处理 |
|---|---|
| **最高优先级：Chromium fork 跟不上安全更新** | fork 只在独立 ADR 确认足够维护团队、自动合并/构建、跨平台回归和安全更新演练后启动；做不到不 fork，也不以实验壳冒充日用浏览器 |
| Electron 原型被误当正式安全证明 | M0 只验用户价值；主进程闸门与可信预览必须在最终内核方案重新实现、攻击测试与验收；Electron 精确版本、更新策略及已知限制待核对官方资料 |
| Fetch 覆盖缺口使 B 阅读层不可用 | 旧样本仅作风险信号；按站点重测，验收第二获取路径和原页回退后再决定 B |
| Search/Fetch 内容使用权待核对 | 核对结果页展示、缓存、正文再分发和摘要引用；无结论不承诺公开版能力 |
| 后续 relay 处理用户查询 | 原型检索默认自带 key/自配服务，总结可用本地模型；若未来上线 relay，明示查询/IP/日志、保留期限与下游去向，验证可完全自托管 |
| 界面因 AI 变复杂 | 每个新增 UI 在真实任务测试中证明必要；默认界面保持地址栏、结果、网页 |
| AI 适配名义兼容、能力实际缺失 | 能力矩阵 + 供应商原生接口合约测试 + 明确降级 |
| 默认服务被滥用或停服 | 免 key 服务有滥用控制、隐私说明与自托管/BYOK 回退；浏览本体不依赖它 |
| Agent 被网页注入操纵 | 页面数据不授予权限；主进程闸门、来源限制、敏感动作人工确认、恶意页面测试 |
| Agent 预览与实际动作不一致 | 预览、授权与执行核对同一来源、标签及文档版本；过期即重新定位，实际结果只由真实网页观察确认 |
| 外部 Agent 接入过于繁琐 | 随应用分发本机 stdio 桥接；提供可复制配置和连接状态；用首次接入步骤与时间实测，保留显式授权 |
| 极客视觉干扰日常浏览 | 任务视图保持内容优先；在窄窗口、缩放、键盘、高对比度和真实用户任务中验证层级与控制可发现性 |
| 视频播放器组件被误当成媒体内核 | 网站播放先验 Chromium 媒体链；Video.js 只在 Grid 自有播放器需求成立时评估；发布包逐项测格式和站点 |
| 编解码或 CDM 无法合法分发 | 对 H.264/AAC 与受保护内容做独立授权/打包决策；公开不支持的网站和格式，避免宣传全部视频兼容 |
| 双内核造成登录态分裂 | 默认单内核；任何双内核方案必须证明资料档、历史、权限和 Agent 一致性 |
| .lattice 的验证结论被误读 | UI 和格式分层呈现完整性、锚点、语义支持、来源真实性与身份 |
| 项目追求“第一”导致功能膨胀 | 以用户任务与开放采用为判断，不以功能数量为指标 |

---

## 13. 第一批具体工作包

1. **代表任务与基线**：先用 PLAN.md 的三项任务与惯用浏览器对照，再修订 20–30 项分解任务；记录来源多样性、干扰、Agent 接管与失败恢复。
2. **Search/Fetch 权利与可靠性核对**：核对展示/缓存/正文/摘要边界；重测 Fetch 失败类型，接入第二检索或获取路径，并验证原页回退。
3. **Electron 纵向原型**：用 Electron/Chromium 和受限 CDP 串起查询结果、A/B 阅读、原页、Agent 预览/暂停/接管；测试资料档隔离。Swift/WebKit 样机冻结；原型仅验用户价值。
4. **最小适配契约**：保留 SearchHit、PageHandle 与动作状态等必要字段；在真实任务中验证后才冻结跨语言 schema，不提前建设 Rust/C++/Protobuf 全栈。
5. **开发者首次体验**：提供自带 key/本地模型路径和本机 stdio/MCP 桥接，记录从 AI 编程工具接入的步骤与耗时；JSON 回执可导出。relay 隐私、权利与完全自托管方案后续研究，未完成前不部署。
6. **G1 决策**：比较继续集成、独立壳与 fork 的用户价值、媒体/日用能力及维护成本；需要 fork 时提交独立 ADR 和安全更新演练。
7. **证据格式（后置）**：核心体验稳定后修正 .lattice SPEC 签名范围及四端一致性，作为按需核验能力独立验收。

这些工作包先验证“自主查询 → A/B 阅读 → 真实原页 → 可预览、可接管的 Agent 动作”；.lattice 后置。任何工作包都不能只以“代码已写”验收。

---

## 14. 一手资料与核对日期

新增核对至 2026-11-02：
- [Chromium 架构](https://www.chromium.org/developers/design-documents/multi-process-architecture/)、[跨平台构建](https://chromium.googlesource.com/chromium/src/+/HEAD/docs/get_the_code.md)、[WebUI 与 Mojo](https://chromium.googlesource.com/chromium/src/+/main/docs/webui/webui_explainer.md)、[安全更新](https://chromium.googlesource.com/chromium/src/+/main/docs/security/updates.md)。
- [DeepSeek Search/Fetch](https://api-docs.deepseek.com/guides/search/)、[开放平台条款](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html)、[DeepSeek Responses 兼容范围](https://api-docs.deepseek.com/guides/responses_api/)；缓存与正文再分发边界仍待专项确认。
- [OpenAI Docs：工具调用](https://developers.openai.com/api/docs/guides/function-calling)、[Claude 工具调用](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)、[Gemini Interactions](https://ai.google.dev/gemini-api/docs/interactions-overview)、[llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)。
- [MCP 传输规范](https://modelcontextprotocol.io/specification/draft/basic/transports)、[WebDriver BiDi 草案](https://www.w3.org/TR/webdriver-bidi/)、[WebMCP 预览](https://developer.chrome.com/docs/modern-web-guidance/guides/webmcp/webmcp)、[Chrome Agent 安全](https://developer.chrome.com/docs/agents/security)。
- [BrowserOS 开源项目](https://github.com/browseros-ai/BrowserOS/blob/main/README.BrowserOS.md)。
- [Electron 安全建议](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron 发布支持策略](https://www.electronjs.org/docs/latest/tutorial/electron-timelines)、[Tauri WebView 版本说明](https://v2.tauri.app/reference/webview-versions/)、[Apple 公证流程](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)。Electron 精确版本、更新节奏、平台限制与 Apple 账号费用/流程细节待专项核对。

一手资料证明接口、实现或发布状态；“这条路线会成为第一”的判断仍须由产品对照、兼容、安全和社区采用实测支持。
