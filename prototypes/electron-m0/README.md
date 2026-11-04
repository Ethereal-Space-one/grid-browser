# Grid Electron M0：第一个可运行切片

此目录用于验证“输入 → 搜索结果 → 干净正文或真实原页”的流程。它不是可日用浏览器，也没有完成 M0 的 Agent、安全和用户价值验收。

## 运行

需要 Node.js 22.12+。在本目录执行：

```sh
npm ci
npm start
```

若要使用 DeepSeek Search/Fetch，请在启动前于本机终端设置 `DEEPSEEK_API_KEY`。密钥只由 Electron 主进程读取，不进入网页或渲染器；不要把密钥写入仓库或截图。未配置时可直接输入 HTTPS 网址，也可访问本机测试页：先在仓库根目录运行 `python3 scripts/serve-fixtures.py`，再输入 `http://127.0.0.1:8765/`。

也兼容已导出的 `DeepSeek_ApiKeyN`；同时存在时优先使用 `DEEPSEEK_API_KEY`。配置后运行 `npm run test:e2e:live`，会在临时浏览器资料档中用真实接口依次验证：搜索与结果展示、Fetch 正文、原页打开、返回结果与查询恢复。它会消耗少量 API 调用，不输出密钥；每个步骤有超时，完整测试最多 90 秒。此项需网络与本机窗口权限，不在普通 CI 中使用真实 key。

测试结束会正常关闭窗口，并把报告保存到被 Git 忽略的 `.local/e2e-live-report.json`。若要测试后继续检查窗口，运行 `npm run test:e2e:live:inspect`；手动试用则运行 `npm start`。

## 当前可验证的行为

- 地址栏区分网址与查询。查询通过 [DeepSeek Search API](https://api-docs.deepseek.com/guides/search/) 返回列表；保留提供者顺序，使用面向 UI 的 `snippet`，不把模型用的 `summary` 当已核对事实。
- 每条结果可打开真实网页（A）或请求 Fetch 正文（B）。B 显示来源与未核对提示；Fetch 失败时仍可打开原页。可从真实原页返回已取得的结果。
- 远程页面使用独立 `WebContentsView`，关闭 Node 集成、启用沙箱和上下文隔离；原型只允许 HTTPS 和本机测试 HTTP，默认拒绝网站权限与弹窗。

## 让现有 AI 工具读取当前页

1. 用 `npm start` 打开 Grid，并进入要读取的真实网页。
2. 点击 **Agent**，选择 **Claude Code / 通用 JSON** 或 **Codex TOML**，再点击 **复制 MCP 配置**，将配置加入对应客户端；本机需有 Node.js 22.12+。通过 npm 启动时会复制实际 Node 可执行文件的绝对路径，减少 GUI 客户端找不到 nvm 中 Node 的问题。配置不包含模型 key，MCP 读取本身不需要 key。
3. 在客户端调用 `grid_connection_status`，Grid 会显示该客户端的连接请求；确认页面后点击 **允许读取当前页**。
4. 客户端调用 `grid_page_snapshot` 读取页面语义摘要；在 Grid 中可随时撤销，也可导出 JSON 读取回执。导航后需要重新授权。

授权最多十分钟，仅针对当前文档。客户端名称为自报，页面数据会返回给该客户端。摘要排除已识别的输入及可编辑子树，但不保证过滤站点放在普通文本中的敏感信息。只覆盖主框架，尚不提供 iframe 读取、写动作或敏感操作授权。

`npm run test:e2e:mcp` 运行无需模型 key 的真实 Electron/MCP 链路检查。2026-11-03 已另外通过 Codex CLI 和 Claude Code 的真实模型调用，真人首次接入体验仍待测量。[SDK 实测](../../docs/SMOKE_MCP_2026-11-02.md) · [编程工具实测与配置步骤](../../docs/SMOKE_HOSTS_2026-11-03.md) · [ADR](../../docs/adr/0001-local-read-only-mcp.md)

真实宿主测试需要已经安装并登录对应 CLI，会消耗该工具的模型用量。运行 `npm run test:e2e:hosts`，或分别运行 `npm run test:e2e:hosts -- --host=codex` / `npm run test:e2e:hosts -- --host=claude`。它使用独立临时资料档和本地合成网页，由测试脚本在首次拒绝后自动点击授权；不修改全局 MCP 配置，不使用你的真实网页或 DeepSeek key。每个宿主最多等待 90 秒；结果存入被 Git 忽略的 `.local/hosts-e2e-report.json`。失败也返回非零退出码，报告不包含模型原始输出、网页正文或凭据。仅供 macOS 开发实测，不纳入普通 CI。

## 尚未完成

- 没有内置模型短总结、第二检索源、登录/媒体/下载/多标签完整兼容或公开分发包。
- 已有本机 stdio/MCP 只读桥接、当前文档授权/撤销与 JSON 读取回执；已有本地固定字段填写实验，尚无外部 Agent 写动作或正式浏览器主进程闸门与可信预览。
- DeepSeek Search/Fetch 的公开展示、缓存和正文使用权仍待专项核对；目前只供开发者用自带 key 本地试验。
- 2026-11-02 已用真实 key 完成一次公开查询的端到端复验，退出流程修正后同场景复跑通过；这不代表其他站点、Fetch 覆盖率或 Agent 能力已验收。[实测记录](../../docs/SMOKE_ELECTRON_2026-11-02.md)

`npm test` 执行构建和本地契约检查。Electron 版本固定为 45.2.1；升级与安全更新流程仍待建立。
仓库 CI 在 macOS、Linux、Windows 构建此原型以尽早暴露平台差异；构建通过不代表三平台安装与使用已经验收。

## 本地填写实验

启动夹具服务器后打开 `http://127.0.0.1:8765/actions.html`，在 Agent 面板输入合成任务代号，依次体验预览、暂停/恢复、确认填写与接管取消。只填写固定文本字段，不提交，也不触发字段事件；不要使用个人数据。导航或字段被人修改后需重新预览。暂停不撤回已完成的填写。

`npm run test:e2e:actions` 验证真实 Electron 表单与失效边界。外部客户端可用 `grid_form_propose({value})` 提出计划、用 `grid_form_status` 查询自己的状态；需要当前文档读取授权，且仍须用户在 Grid 单独确认。提案不会填写，也不能覆盖待处理预览。撤销、断开与导航使未执行提案失效。导出的 JSON 附带 `formActions` 状态元数据，不含填写值；正式安全模型尚未验证。[实验范围与实测](../../docs/SMOKE_ACTIONS_2026-11-03.md)

`npm run test:e2e:hosts:forms` 验证真实 CLI 的合成页面填写提案，仍由脚本模拟 Grid 授权、暂停、恢复与确认。可附加 `-- --host=claude` 或 `-- --host=codex --host-timeout=160000`。默认每宿主 90 秒，上限参数最多 180 秒；加长上限不代表产品响应达标。本次 Claude Code 通过，Codex 首轮超时后经网络回退复验通过，详见[立项与体验复核](../../docs/UX_HOST_FORMS_2026-11-03.md)。

## 首页场景选择

专业、学习、生活、娱乐、灵感五种场景会切换配色与轻量动效。默认按场景优化 Search 查询；可取消勾选使用原始查询，结果页显示实际查询。网址直达保持原样。

Fetch 正文打开后，可主动点击“按当前场景提取重点”；这会额外调用 DeepSeek 模型，发送最多 16000 字符的当前公开正文。AI 重点与原文分开展示，失败时仍可阅读原文。本轮已通过合成响应的端到端参数验证，真实检索质量仍待评价。[实现与验证](../../docs/SEARCH_SCENES_2026-11-04.md)。
