# 首页继续上次：定向检查

- 公开工作基线：`ba38fd747e2566441db86685b53dd776586e8cb9`。独立工作副本，未写 GitHub，未改原始公开或私有目录。
- 首页只有一个继续入口，附探索标题与停留阶段。只展示已完成、未移除的实质步骤；新首页、仅场景/草稿、取消/失败-only 路径不展示。非持久路径不展示。
- 点击使用既有可信 `storageRestore` 路径的新可选严格恢复参数：源首页 owner/entry 必须仍匹配，目标必须仍为可信 continuation。旧记录恢复调用不变。
- 对已有探索跳到保存内容，不调用模型。网页只复用已处于精确节点的存活视图，否则显示原有 history-lost 恢复提示，不调用 loadURL、原生历史跳转或 reopen。继续不执行操作、不恢复授权。
- 场景说明明确可选；空输入本地提示「输入问题或网址」、aria-invalid 和焦点，无 submit IPC；IME 未结束时忽略提交。

## 已执行

- 公开构建通过；定向 `test-home-continuation.cjs` 9/9 通过。
- 私有移植构建和 svelte-check 通过（0 errors / 0 warnings）；legacy DOM 9/9，Svelte 生产构建 DOM 9/9。
- 公开现有 `npm test`：107/110 通过；3 个既有 MCP bridge 测试因执行环境 Unix socket listen EPERM 受阻，申请放宽执行后仍同样受阻。不计为完整通过。
- 未启动原生 Electron 窗口，无实际 UI/几何/屏幕阅读器验收；这些仍需单独检查。

依赖使用已准备的 jsdom 路径通过 `GRID_TEST_DEPENDENCY_PATH` 指定。生产代码无新增依赖，测试只用合成网页和数据，不访问外部服务。
