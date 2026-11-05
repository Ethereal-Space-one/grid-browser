# 窗口、标签与阅读连续性：第二阶段实施记录

日期：2026-11-04。范围：[ADR 0002](./adr/0002-next-stage-architecture.md) 第二切片的内存状态、生命周期与授权隔离；接续[第一切片](./SMOKE_REQUESTS_2026-11-04.md)。应用完整退出后的恢复仍未实现，不能将本轮写成第二阶段全部验收或正式浏览器完成。v0.1.0 标签与既有预览包未修改。

## 用户可见的变化

- 新建、切换和关闭标签；可另开窗口，结果可选择在新标签打开。查询、五场景、首页草稿、结果、正文、提取和阅读位置分别属于各标签。正在阅读时发起搜索会保留原内容，取消入口位于真实网页上方。
- 后退/前进穿过结果、正文和真实网页；返回缓存的结果/正文不重新请求。切换仍存活的网页标签保留原生页面的输入与滚动位置，不把表单状态或 Chromium pageState 发给界面或写入恢复文件。
- `⌘/Ctrl+T` 新标签、`⌘/Ctrl+N` 新窗口、`⌘/Ctrl+W` 关闭当前标签、`⌘/Ctrl+L` 地址栏、`⌘/Ctrl+R` 刷新真实网页。标签栏方向键/Home/End 移动焦点，Enter/Space 选择，Delete 关闭；沿用浅深色和减少动态效果。
- Agent 面板指向最近激活的 Grid 窗口及其当前真实网页。切换标签/窗口、导航、隐藏、最小化或关闭目标会撤销读取及未执行提案；切回或重新显示不会自动授权。外部编程工具取得焦点本身不撤销仍可见的 Grid 页面授权。关闭无关后台标签不撤销当前页的有效授权。

## 实现与边界

`WindowRegistry` 管理已登记的可信窗口和 Agent 目标；`TabRegistry` 管理标签资源。每标签有独立的 `BrowsingSession`、网页视图、文档身份和受限动作实例。视图按需创建；关闭时中止所属请求并显式关闭 webContents。应用单实例锁防止第二进程同时使用同一资料档和桥接描述文件。

界面操作捕获所属标签，保存位置后仍校验 owner；授权还绑定用户看到的 documentId。过期点击不能把查询、确认或授权作用到后来切换的标签。读取前后均核对同一目标；观察到文档/可见范围失效后清除旧授权，不能因原页面再次出现而恢复。

产品导航采用内存历史，每标签最多 32 项、唯一检索/正文/提取文本预算 8 MiB；同一内容对象不重复计数，至少保留当前项。当前最多 4 个窗口、每窗口 12 个标签。这些是保守原型上限，不是性能结论、整个进程内存上限或日用容量承诺。网页原生历史仍由 Chromium 管理；目标历史不可用时退回 URL 加载，不能承诺任意动态页都精确恢复。

标签共用 `persist:grid-m0` 登录资料档；独立查询和授权不等于隐私资料档隔离。后台搜索可以继续，完成后只更新原标签；关闭标签会取消本地等待。整个应用退出后的窗口/标签恢复、重新打开关闭标签、标签拖出窗口、私密资料档及广泛站点兼容均未实现。弹窗和站点权限仍默认拒绝，网页 `target=_blank` 不因此获准。

## 本机验证

环境：macOS arm64；Node v26.12.1、Electron 45.2.1、TypeScript 7.0.2。没有升级依赖。命令在 `prototypes/electron-m0/` 执行。

| 检查 | 本轮结果与范围 |
|---|---|
| `npm test` | 26 项通过；含导航分支/数量与文本预算、独立标签销毁、关闭后晚响应、授权失效后回到原文档仍拒绝 |
| `npm run test:e2e:tabs` | 13 组通过；真实窗口与 MCP，覆盖结果/正文位置及无重复 Fetch、草稿与场景隔离、过期 UI owner、原生输入/滚动及混合历史、可见取消、后台请求/关闭、跨标签提案/授权、SPA 导航、隐藏后重新授权、跨窗口拒绝、键盘和单实例 |
| `npm run test:e2e:requests` | 11 组既有请求/上下文/UI 来源/重载与崩溃回归通过 |
| `npm run test:e2e:mcp` | 8 组既有官方 SDK stdio/授权/读取/撤销回归通过 |
| `npm run test:e2e:actions` | 12 组既有固定字段提案/预览/确认/失效回归通过；没有扩大写动作范围 |
| `npm run test:e2e:visual` | 浅深色、320/375/414/768/1180 宽度、减少动效及新建按钮可见性通过；不等于完整无障碍验收 |

报告和截图位于被 Git 忽略的 `.local/tabs-e2e-report.json`、`.local/tabs-preview.png` 及 `.local/preview-dark.png`。所有页面/服务数据为合成内容，MCP 使用真实本机管道与 SDK；本轮未使用个人 key、未重跑真实模型宿主计费测试，不能推导搜索质量或真人收益。CI 已加入 macOS 标签链路，但尚未推送或取得远端运行结果。

本轮检查曾发现隐藏时读取虽被拒、显示后旧授权却可能恢复的问题；补充显示/恢复时撤销及范围失效清理后复验通过。首轮位置测试抢在界面恢复前模拟滚动，已等待实际绘制后再模拟操作。日志中的旧 owner、旧授权和跨窗口 IPC 拒绝是预期断言；本机回环服务测试需允许本机监听，没有关闭 Electron 沙箱。

## 依据与下一步

参考 [Electron navigationHistory](https://www.electronjs.org/docs/latest/api/navigation-history) 保持原生网页历史、[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view) 和[资源管理](https://www.electronjs.org/docs/latest/api/base-window#resource-management)显式管理网页生命周期；用[单实例锁](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata)约束进程，标签键盘路径依据 [WAI-ARIA Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)。一手资料支持接口选择，不证明 Grid 整体安全。

下一步完成最小、版本化的应用退出恢复：先定义允许保存的数据和损坏回退，不默认落盘正文/表单值，不恢复旧授权或自动发起写动作。随后进入动作发送后的 unknown、人工输入栅栏与只读核对。真人搜索/场景提取继续并行；第二检索源、连接器/分发和 G1 仍按主计划验收。
