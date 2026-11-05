# ADR 0001：M0 本机只读 MCP 桥接

日期：2026-11-02。状态：原型已实现；正式浏览器安全架构未通过验收。服从 PLAN.md。

2026-11-03 收尾复验通过，实际宿主接入仍为下一阶段。

后续状态说明（2026-11-04）：以下正文保留初始只读决策。之后已完成[真实宿主读取](../SMOKE_HOSTS_2026-11-03.md)和[本地固定字段提案](../UX_HOST_FORMS_2026-11-03.md)实验，现工具面还包含 `grid_form_propose` / `grid_form_status`，执行确认仍只在 Grid；不代表通用写权限。下一阶段权限与状态分层见 [ADR 0002 提案](./0002-next-stage-architecture.md)。

首批开发者已有 AI 工具。Grid 先提供标准 stdio MCP 接口，使这些工具能在用户明确授权后读取当前真实页面，避免先建设独立模型编排栈。

采用官方 MCP TypeScript v2 SDK（本次固定服务端/客户端 2.4.0）与 Node/TypeScript。桥接进程和 Electron 之间使用 Unix socket / Windows named pipe，不启动 HTTP 端口，不向外开放 CDP。连接信息保存在用户资料档中的本机文件，包含本次运行随机令牌；复制的 MCP 配置只含桥接入口和文件路径，不含令牌或模型 key。

每个本机连接先处于未授权状态。客户端名称仅为自报值，不是经过认证的应用身份。Grid 界面授予当前文档、当前连接最多十分钟的读取权限；导航、隐藏原页、关闭窗口、撤销、到期或断开后拒绝读取。读取完成前再次检查同一授权对象及文档身份，防止读取中撤销仍交付结果。原型使用本机文件访问控制和随机令牌认证，没有验证对端进程签名或完整 OS 身份；同一用户的恶意进程与正式权限闸门仍需后续威胁建模。

仅开放 `grid_connection_status` 与 `grid_page_snapshot`。后者由 Electron 主进程通过固定 CDP `Accessibility.getFullAXTree` 调用取得当前主框架的可访问性树，只返回有上限的角色和名称（最多 1000 行、16000 字符）。不开放任意脚本、Cookie、网络工具或写动作；跳过已识别的输入及可编辑子树，不返回 AX value。它不是通用敏感信息清洗器：站点写进普通页面文本的内容仍可能返回，用户需要选择适合分享的页面。动态变化、iframe 和特殊控件覆盖还需实测。

读取回执保存在内存中，最多 500 条；用户主动导出 JSON，包含客户端、时间、来源、文档身份、结果、字符数和内容摘要哈希，不保存网页正文、字段值、模型 key 或登录 Cookie。被拒绝的读取也留有记录。

2026-11-02 验证了官方 SDK 客户端 → stdio 子进程 → 本机管道 → Electron 授权 → CDP 页面读取 → JSON 回执，并验证读取前拒绝、读取中撤销、导航后拒绝、错误令牌和断开清理。测试页通过 HttpOnly 测试 Cookie 验证同一浏览会话。该结果不等于 Codex、Claude Code、Cursor 的实际宿主配置和首次接入体验已通过，也不等于最终内核安全模型已通过。

依据：[官方 SDK v2](https://github.com/modelcontextprotocol/typescript-sdk)、[Electron Debugger API](https://www.electronjs.org/docs/latest/api/debugger)。
