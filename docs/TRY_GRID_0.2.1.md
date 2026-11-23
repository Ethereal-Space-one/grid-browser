# 试用 Grid 0.2.1

这是 Electron/Chromium 开发者预览的当前入口，不是冻结的 Swift 样机，也不是离线设计演示。公开标签和附件以 [GitHub Releases](https://github.com/Ethereal-Space-one/grid-browser/releases) 为准；没有 0.2.1 附件时请从源码运行，不要把 0.2.0 包当作新版本。

## 从源码运行

需要 Node.js 22.12+；CI 使用 Node.js 24。当前原生预览面向 macOS，其他平台的构建检查不表示安装与日用能力已验收。

从个人主页或仓库首页直接打开本指南时，先单独克隆预览分支；普通的 `git clone` 会取到较早的 `main`。以下命令不会切换你已有工作区的分支。

```sh
git clone --branch release/v0.2.1 --single-branch https://github.com/Ethereal-Space-one/grid-browser.git grid-preview
cd grid-preview/prototypes/electron-m0
node -p "require('./package.json').version"  # 应为 0.2.1
npm ci
npm start
```

已经在正确分支的仓库根目录？直接进入 `prototypes/electron-m0`，核对版本后执行 `npm ci` 和 `npm start` 即可。

启动不需要服务 key。需要搜索、公开正文或模型功能时，在首页「搜索服务设置」输入自己的 DeepSeek API key，点「本次启用」。这不是电脑登录密码；手动 key 不写磁盘，完全退出后失效。不要把 key、私人网页或任务记录发进反馈。

## 不需要 key：本地网页例子

另开终端，进入刚才克隆的仓库根目录（上例为 `grid-preview/`），运行：

```sh
python3 scripts/serve-fixtures.py
```

1. 在 Grid 地址栏打开 `http://127.0.0.1:8765/`。这是合成浏览器夹具，不是产品搜索结果。
2. 在「任务代号」中输入不含个人信息的 `GRID-DEMO`，但先不要提交；滚动网页，再打开地图、切换紧凑/舒展或横竖布局，检查输入和阅读位置是否保留。
3. 点击「打开第二页」，再用后退或地图返回已有页面，检查分支与位置。页面实例丢失时应显示明确恢复入口，不自动重发表单。
4. 没配置 key 时若主动请求总结，应得到服务设置或后退等出口，而不是合成的成功回答。配置服务、获取公开正文和网站当前页面是不同步骤。

夹具包含下载、媒体和 iframe，但本例不把这些能力标为已验收；详细范围见 [夹具说明](../fixtures/web/README.md)。

## 使用自带 key：阅读与核对

选择一个你确实想弄清楚的公开问题，直接搜索；场景是可选项。

- 点结果标题打开网站原页，再主动总结或问这页。总结用公开文本 Fetch，不读取登录态正文；回答和引文仍需你核对。
- 需要比较时回到结果，点「选资料对照」，按顺序选 A/B，再点「对照这两份」。选择本身不调用模型；明确开始对照后才取得缺失正文和生成分析。
- 对照中先看结论，按需展开依据与来源。引用快照是取得时固定的文本；「打开网站原页」是网站当前内容，两者可能不同。
- 写下「我的判断」并保存为版本。从判断引文主动打开网站后，只在当前一次性上下文仍有效时使用「返回判断」。切标签、导航、失焦等会撤销此临时入口，不能把它当作永久返回书签。
- 等「记录」显示已保存，正常退出后重开。首页「继续上次」只恢复有实质内容的正常探索；原页或正文缺失时仍需你主动重新打开/获取，不自动重放网站操作或旧授权。

这些是试用步骤，不是预填的成功结果。可用 [空白反馈模板](./developer-trial.template.csv)记录实际完成情况，不测量的字段留空；私人结果保留在本机 `.local/`，不要默认提交仓库。0.1.0/0.2.0 的旧指南和本机路径仅作历史记录。

## 区分三种入口

- 当前产品：`prototypes/electron-m0/`，以 [原型 README](../prototypes/electron-m0/README.md) 和 [0.2.1 发布说明](./releases/0.2.1.md) 为准。
- 离线设计参考：`prototypes/reading-flow/`，数据均为合成示例，不联网、不读取 key，不代替当前生产回归。
- 冻结历史对照：`Sources/GridBrowserProbe/`，仅用于 Swift/WebKit 历史复现，不是当前 Grid 应用。
