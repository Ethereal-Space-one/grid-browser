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

## 尚未完成

- 没有内置模型短总结、第二检索源、登录/媒体/下载/多标签完整兼容或公开分发包。
- 没有本机 stdio/MCP 桥接、Agent 动作、暂停接管、JSON 回执，也没有正式浏览器主进程闸门与可信预览。
- DeepSeek Search/Fetch 的公开展示、缓存和正文使用权仍待专项核对；目前只供开发者用自带 key 本地试验。
- 2026-11-02 已用真实 key 完成一次公开查询的端到端复验，退出流程修正后同场景复跑通过；这不代表其他站点、Fetch 覆盖率或 Agent 能力已验收。[实测记录](../../docs/SMOKE_ELECTRON_2026-11-02.md)

`npm test` 执行构建和本地契约检查。Electron 版本固定为 45.2.1；升级与安全更新流程仍待建立。
仓库 CI 在 macOS、Linux、Windows 构建此原型以尽早暴露平台差异；构建通过不代表三平台安装与使用已经验收。
