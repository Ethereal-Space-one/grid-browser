# 设计与交付实践复核

日期：2026-11-04。此处记录实际查阅的公开一手资料、采用理由与没有采用的部分，不声称复刻 Apple 或完整审计其他项目源码。

| 来源 | 学习与在 Grid 的落地 |
|---|---|
| [Apple HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion)（已读取官方 Markdown 正文） | 动效应服务反馈、短促且可以减少。场景切换保留轻微变化，遵守系统减少动态效果，不做持续背景动画。 |
| [Apple HIG Color](https://developer.apple.com/design/human-interface-guidelines/color) | 作为研究入口；本次正文获取未成功，不据此引用具体色值。Grid 的中性色和五种场景色是项目自定义值，不声称是 Apple 官方颜色。 |
| [Electron Application Packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution) | 官方推荐 Forge，也提供手动放置 resources/app 的方式。本轮使用现有本机 Electron 与离线生产依赖完成可复现本地预览，不额外引入打包依赖；正式发行仍需评估 Forge、签名、公证与更新。 |
| [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)及已安装 Electron 45 的类型定义 | 采用系统加密存储。实测发现同步接口弃用提示，改用异步可用性检查、加密与解密，避免阻塞界面和继续依赖弃用入口。 |
| [Zen Browser 官方仓库 README](https://github.com/zen-browser/desktop) | 查阅其面向用户的下载、文档、发布说明、问题与贡献入口安排。Grid 增加统一预览说明和三项试用任务，后续反馈走明确入口。没有复制其源码、品牌、图标或宣称继承其兼容性。 |
| [DeepSeek Search/Fetch](https://api-docs.deepseek.com/guides/search/) | 使用支持的参数；场景提示词不伪装成 Fetch 参数。完整原文、模型提取及实际查询保持可区分。 |

## 本轮视觉决策

- 系统字体、浅灰画布与白色内容层；深色自动跟随系统。
- 专业/学习/生活/娱乐/灵感的色彩保留，但用于选中态、提示和主操作，不把整页染成大面积彩色背景。
- 场景选择用分段控制结构；搜索为主要动作；服务配置折叠；结果改成连续阅读列表，减少卡片边框和装饰。
- 原页、来源、模型未经核对提示和人类确认仍可见。
- 设计变量集中在仓库根目录 tokens.css，构建时复制到渲染器；后续可以统一调整。

Hallmark 自评：理念4、层级4、执行4、针对性4、克制5、多样性3（1–5分）。这是内部自检，不是用户满意度测量。实际查看浅深色截图并做宽度/减少动效回归；正式无障碍、色彩对比自动审计、原生 macOS 控件体验与真人反馈仍待完善。
