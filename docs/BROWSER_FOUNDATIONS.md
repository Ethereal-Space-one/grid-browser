# Grid 浏览器基础能力与媒体决策门（v0.1）

> 2026-10-31。补充 [主计划](../PLAN.md) 的浏览器基本功与 [技术方案](../TECHNICAL_PLAN.md) 的 G1 内核决策。以下是待实施和待验收的要求，不代表当前样机已支持。

## 1. Video.js 应放在哪一层

用户在任意网站播放视频，依赖内核的 `<video>`/`<audio>`、解封装与编解码、Media Source Extensions（MSE）、Encrypted Media Extensions（EME）与 CDM、GPU/音频设备、权限和操作系统集成。Video.js 是网页播放器的组件与控件层，不能替浏览器补齐缺失的 codec、DRM 或硬件解码。[Chromium 媒体目录](https://chromium.googlesource.com/chromium/src/+/HEAD/media/README.md)、[Video.js 原生 Video 组件](https://videojs.org/docs/framework/react/reference/components/video)

Grid 保持网站原本的播放器与网页行为；不在第三方页面注入或替换为 Video.js。若 Grid 将来提供自有的独立媒体查看器、教程或演示播放器，Video.js 10 是候选。当前规划的 Grid WebUI 使用 TypeScript + Lit，因此先评估框架无关的 `@videojs/html`；只有决定采用 React 的独立界面才选 `@videojs/react`。两种安装路径均由 Video.js 官方提供；固定版本、自托管、核对许可证和 CSP，避免运行时依赖外部 CDN。是否加入产品，要由“用户确实需要自有播放器”与体积、键盘、字幕、辅助技术及媒体能力实测决定。[Video.js React 安装](https://videojs.org/docs/guides/installation/react)、[Video.js HTML 安装](https://videojs.org/docs/guides/installation/html)、[Video.js 10 稳定版记录](https://videojs.org/changelog/10.0.0)

## 2. 横向基础能力矩阵

P0 是宣称可日用浏览器前必须验证的能力；P1 是首个公开版本中明确给出支持状态和后续路径的能力。每项都以**实际分发的 Grid 安装包**测试，不能用上游 Chromium 或系统浏览器的理论支持代替。

| 基建 | P0 验收 | P1/单独决策 |
|---|---|---|
| 媒体播放 | 有声视频与音频的播放、暂停、拖动、变速、音量/静音、全屏、字幕、跨标签继续播放；常见 WebM/AV1/VP9 和目标站点所需 MP4/H.264/AAC 逐项实测；有明晰的不支持提示 | HLS/DASH、直播、画中画、后台媒体键、投屏；按站点兼容范围决定首版门槛 |
| 媒体解码与保护 | 软件/硬件解码和 GPU 故障回退可测；按平台记录 CPU、耗电与掉帧；核对 H.264/AAC 分发条件 | EME/CDM 与受保护流媒体单独评估授权和打包，不假定 Chromium 源码自带可分发 Widevine |
| 实时通信 | 摄像头、麦克风、屏幕共享的授权/撤销、设备切换、通话中切标签与休眠恢复；WebRTC 音视频在目标会议网站可用 | 多设备、蓝牙耳机、回声消除和高级共享场景形成持续兼容集 |
| 文档与打印 | PDF 打开、搜索、缩放、下载、打印；网页打印预览及另存 PDF；文本选择和复制正常 | 注释、表单填写、签名及更复杂文档格式按用户任务决定 |
| 文件往返 | 上传、拖放、下载、保存位置、失败续传或清楚报错；文件选择器不泄露额外文件 | File System Access、目录上传和大文件/断点续传按目标网站测 |
| 身份与资料 | 常见登录、Cookie/站点存储、密码填充、Passkey/WebAuthn、退出后清理、隐私窗口、资料档隔离 | 密码管理器集成与跨设备同步由独立的隐私/维护决策门确定 |
| 权限与设备 | 站点来源明确、最小授权、可查看/撤销；通知、位置、摄像头、麦克风、剪贴板、弹窗 | 蓝牙、USB、MIDI、串口等高权限 Web API 按使用场景开放 |
| 网络与离线 | HTTPS/TLS、代理、证书错误、离线提示、Service Worker/缓存、下载中断与恢复；不降低安全边界 | PWA 安装、推送与后台任务在跨平台安装包中单独验证 |
| 扩展与迁移 | 书签/历史/密码导入及导出路径；目标扩展的安装、权限、运行和移除 | 扩展商店分发、同步与更广 MV3 兼容按政策和实测推进 |
| 可访问性与本地化 | 键盘、屏幕阅读器、焦点、高对比度、缩放、中文输入法；媒体字幕与控制条可操作 | 更多语言、字幕偏好与媒体可访问性持续扩展 |
| 输入与语言 | 表单自动填充、撤销、拼写检查、网页内查找和中英文输入不丢字符 | 网页翻译与多语种词典由独立服务/本地能力决策，不默认依赖 Google 专有服务 |
| 系统与维护 | 默认浏览器注册、链接唤醒、通知、系统媒体键、崩溃恢复、自动更新、跨平台安装与卸载 | 投屏、桌面快捷方式等系统集成依平台测试 |

媒体 P0 的具体编码集合由目标用户实际访问的网站和各平台可合法分发的能力确定。Chromium 的公开音视频列表将 H.264/AAC 列在 Chrome 专有编解码一侧，因此不能把“Chromium 可编译”推断为“Grid 安装包能播放所有 MP4”。[Chromium 编解码说明](https://www.chromium.org/audio-video/)

## 3. 类似 Video.js 的组件候选与落点

| 用户能力 | 上游/候选 | Grid 的接入原则 |
|---|---|---|
| 自有媒体播放器控件 | Video.js 10 的 `@videojs/html`，独立 React 界面才用 `@videojs/react` | 仅负责 Grid 自有界面；网站继续用各自播放器，媒体解码由内核负责 |
| PDF 阅读与打印 | Chromium PDF 查看器及 PDFium | 先验证随安装包可用的 PDF/打印路径；有明确缺口才考虑另建阅读 UI。[PDFium 官方说明](https://pdfium.googlesource.com/pdfium/+/HEAD/docs/getting-started.md) |
| 网页会议 | Chromium 的媒体采集、权限与 WebRTC | 先修浏览器设备/权限集成和站点兼容，不在 Grid 侧加一套会议 UI。[WebRTC 项目](https://webrtc.googlesource.com/src) |
| 表单与拼写 | Chromium Autofill、系统或 Hunspell 拼写检查 | 保留标准输入行为；资料保存、外发服务与词典按隐私和平台逐项核对。[Chromium Autofill](https://chromium.googlesource.com/chromium/src/+/HEAD/components/autofill/)、[拼写检查构建选项](https://chromium.googlesource.com/chromium/src/+/HEAD/components/spellcheck/spellcheck.md) |
| 身份、离线和扩展 | 内核 WebAuthn/Credential、Service Worker、MV3 | 以目标站点和实际包验收；缺失浏览器界面或系统桥接时补齐，避免重复造协议层 |

这些组件只回答某一层如何实现。能否成为 Grid 的发布能力，取决于实际网站、操作系统、许可、隐私和用户任务测试。

## 4. G1 增加的媒体与基础能力实验

1. 为每个平台、架构和实际安装包记录 `canPlayType`/MediaCapabilities 结果、构建参数、可分发组件、已知缺口；实测播放结果优先于能力探测结果。
2. 用可再分发的小样本测试 WebM/VP9、AV1、MP4/H.264/AAC、字幕、HLS/DASH、错误文件；分别报告启动时间、连续播放、拖动、全屏、画中画、CPU/掉帧与电量。需要授权的编码或 CDM 在许可核对后进入发布包。
3. 选定公开的真实视频网站、音频站与视频会议站，测试登录、受保护内容（若合法可测）、摄像头/麦克风/共享屏幕、设备切换和权限撤销。记录地区、系统、硬件、站点政策、失败原因，不以单站失败概括整个媒体栈。
4. 同时跑 PDF/打印、上传下载、Passkey、PWA/离线、扩展、输入法及辅助技术；每个能力保留一个本地夹具和一个目标真实网站。把破坏日常任务的缺口作为 G1 决策与 M1 发布门槛。

## 5. 决策出口

G1 选择内核时附上“可播放格式与站点清单”“受保护内容状态”“基建缺口清单”和“分发许可/更新责任”四份可复查材料。M1 对外试用前，所有 P0 场景要在实际安装包上通过或明确收窄首批支持范围；P1 状态公开，不用一个“支持视频”掩盖 codec、DRM、字幕或系统集成差异。
