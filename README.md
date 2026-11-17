# DeepSeek 对话面板 / DeepSeek chat panel

在 Harness 里直接和 [chat.deepseek.com](https://chat.deepseek.com/) 聊天，并保留登录状态。

Open **chat.deepseek.com inside Harness** and keep the DeepSeek login across page reloads and
Harness restarts.

![面板 / The panel](assets/screenshot-panel.png)

## 安装 / Install

在 Harness 的插件市场里搜索 `dsh-deepseek-chat-panel`，安装并启用，然后重启 `dsh web`。
也可以走命令行：

```bash
# 从 npm 安装
dsh plugin --profile web add dsh-deepseek-chat-panel
```

从本工作区源码安装时，先在项目目录完成下文的安装依赖和构建，再运行：

```powershell
# 本地文件夹叫 dsh-deepseek-chat，npm 包名仍然是 dsh-deepseek-chat-panel。
dsh plugin --profile web add "D:\MyCodes\test\deepseek\dsh-deepseek-chat"
```

`dsh plugin add` 把包装进 profile 后，还需要在 Harness 的插件列表里启用它。启用时会应用
[cordis.patch.yml](cordis.patch.yml)，让 Host 加载该插件，再重启 Harness。
源码以 link 方式安装时，修改 Host 代码后重启 `dsh web`；修改页面源码后先构建，再刷新已有的 Harness 页面。

## 为什么需要代理 / Why a proxy

`chat.deepseek.com` 返回 `content-security-policy: frame-ancestors 'none'`，浏览器不允许把它直接
嵌进 iframe。站点还用到了 `HttpOnly` 等脚本无法直接读取的 Cookie，需要由 Host 接收和保存。

因此本插件的 **Host 端**在本机 `127.0.0.1` 上运行反向代理：

- 去掉上游响应中阻止 iframe 加载的头。
- 把上游 `Set-Cookie` 收进 Host 的 Cookie 罐，请求上游时再带上。默认文件在
  `<DSH_HOME>/deepseek-chat/cookies.json`，未设置 `DSH_HOME` 时位于 `~/.dsh/deepseek-chat/cookies.json`。
- 改写入口 bundle（`main.*.js`）：强制生产环境，把 CDN public path 指向本机代理，让懒加载资源走同源地址，
  并让 TTS WebSocket 根据页面协议选择 `ws` 或 `wss`。
- 把样式表里的字体和图片地址改走代理，避免上游 CDN 的 CORS 规则阻止回环源加载资源。

**页面端**提供侧栏按钮和全屏浮层 iframe（`shell.overlay`）。它通过 Harness 同源的
`GET /plugins/deepseek-chat/status` 查询实际代理地址。首选端口 `3097` 被占用时，代理会使用空闲端口，
页面端无需写死端口。Cookie 文件可以跨重启保留，但上游过期或撤销凭据后仍需重新登录。

## 用法 / Usage

1. 刷新 Harness 页面。
2. 点击左下角设置按钮旁的聊天气泡，打开面板。
3. 在面板里登录一次；之后 Host 保存 Cookie。只绑定了微信的账号请使用下面的「登录态同步」。
4. 标题栏提供 **在浏览器中打开**、**重新加载**、**同步登录态**、**关闭**。
   `Esc` 也能关闭；关闭后 iframe 仍在后台保留，重新打开时可以接着聊天。

「在浏览器中打开」访问的是同一个本机代理地址，可用于必须在顶层窗口进行的登录。

## 微信扫码和登录态同步 / WeChat QR and login import

微信的 `WxLogin` 组件会检查 `redirect_uri` 是否属于其授权域名。面板位于回环地址，无法完成这一验证；
扫码后的浏览器还要跳回 `chat.deepseek.com` 交换登录态，所以微信扫码不能直接在面板里完成。

只用微信登录的账号可以这样导入：

1. 在普通浏览器里登录 [chat.deepseek.com](https://chat.deepseek.com/)。
2. 在该标签页按 `F12` 打开 Console，运行面板「同步登录态」里提供的复制命令。
3. 回到 Harness → 打开面板 → **同步登录态** → 粘贴 → **同步并刷新**。

提交的凭据会经过**本机 Harness Host 和回环代理**。页面通常先调用 Harness 同源的
`POST /plugins/deepseek-chat/sync`；该路由不可用时，页面会尝试代理侧的 `POST /__ds/sync`，
独立开发代理也使用后者。Host 把凭据保存为待同步状态，再在下次文档加载时注入脚本，写入代理页面的
`localStorage`，对应 `userToken` 和 `__appKit_userInfo` 两个键。同步导入不直接修改 Cookie 罐；
之后网页访问 DeepSeek 时会像正常登录一样使用凭据。

同步接口不提供凭据读取功能。凭据会以明文出现在代理页面的 `localStorage` 和待确认的
`pending-sync.json` 中。注入脚本成功写入 `localStorage` 后，会向 `POST /__ds/sync/ack` 提交随机的
`syncId`；只有它与当前待同步项匹配，代理才清理该项和状态文件。写入或确认失败时保留凭据以便下次加载重试；
旧页面的空回执或旧 `syncId` 不会清理后来排队的新 token。请只在自己的设备上导入，登录是否继续有效仍由上游决定。

## 配置 / Configuration

Host 端从环境变量读取配置，修改后重启 Harness 生效。绑定地址固定为 `127.0.0.1`。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DSH_DEEPSEEK_CHAT_PORT` | `3097` | 首选端口，必须是 `1..65535` 的整数；无效值回退到默认值，占用时改用空闲端口 |
| `DSH_DEEPSEEK_CHAT_STATE` | `<DSH_HOME>/deepseek-chat` | 保存 `cookies.json`、`pending-sync.json` 的目录；空值使用默认目录 |
| `DSH_DEEPSEEK_CHAT_DEBUG` | 关闭 | 只有 `1` 开启请求调试日志；鉴权仅记录 `present` / `none`，不输出 `Authorization` 内容 |
| `DSH_HOME` | `~/.dsh` | Harness 数据根目录；未单独指定状态目录时用于拼出默认目录 |

开发代理默认把状态放在本项目的 `.cache/state`，可用 `npm run dev -- 0` 自动分配端口；命令行端口优先于环境变量。
这些入口都不会自动读取 `.env`。字段解释、PowerShell 示例以及 JSON 清单说明见
[配置说明](docs/configuration.md)。

## 开发 / Development

使用 Node.js 20 或更新版本，在项目目录依次运行：

```powershell
npm ci
npm run build
npm run check
npm test
```

`npm ci` 按锁文件安装依赖，包含构建用的 **esbuild**。esbuild 只是开发依赖，用来把
[src/client](src/client/) 中的 ESM 源码打包为根目录 [client.js](client.js)；安装并运行已经构建好的插件时不需要 esbuild。
请修改页面源码后重新执行 `npm run build`，并把源码与生成的 `client.js` 一起提交。

`npm run check` 运行 [scripts/check.mjs](scripts/check.mjs)，递归检查 `src`、`scripts`、`test` 和根入口的语法，
并临时构建页面源码，与现有 `client.js` 比较，不更新已提交产物，结束时清理临时目录；单独运行
`node scripts/build-client.mjs --check` 也可校验页面产物。`npm test` 执行本地测试。验证完成后，还应在真实 Harness 页面里打开面板、
检查登录和同步。要脱离 Harness 单独运行 Host 代理，可以使用：

```powershell
npm run dev
npm run dev -- 0
npm run dev -- 3100
```

启动后终端会打印 `probe-url http://127.0.0.1:实际端口/`，用浏览器打开即可；`Ctrl+C` 关闭代理并保存 Cookie。
CLI 端口允许 `0..65535` 的十进制整数，非法参数会直接报错退出，不能用小数、负数或 `3097abc` 之类混合文本。

### 文件结构与职责

```text
dsh-deepseek-chat/
├─ index.js                  Host 入口，启动代理并注册状态和同步路由
├─ client.js                 生成的页面入口，保留 Harness 模块加载协议
├─ src/
│  ├─ client/                页面 ESM 源码
│  │  ├─ index.js            注册 Harness 页面模块
│  │  ├─ plugin.js           装配插件、注册 UI 插槽
│  │  ├─ state.js            共享面板显隐状态
│  │  ├─ api.js              查询代理地址，同源同步及备用同步
│  │  ├─ locales.js          页面词典和翻译回退
│  │  ├─ styles.js           面板样式及挂载
│  │  └─ components/         按钮、面板和同步弹窗组件，复用 Harness 的 React
│  ├─ config.js              集中存放常量和 readProxyConfig(env)
│  ├─ host-routes.js         注册 Harness 同源状态查询和登录态同步路由
│  ├─ cookies.js             Cookie 收集、合并、过滤和写盘
│  ├─ http.js                HTTP 解压、路径、来源与响应头工具
│  ├─ login-store.js         待同步登录态队列，串行写盘和按凭据清理
│  ├─ sync.js                登录态解析、校验和 HTML 注入
│  ├─ proxy-sync.js          代理侧同步控制接口、syncId 确认及旧空回执兼容
│  ├─ forward.js             HTTP 转发、静态资源缓存、网页改写和凭据注入
│  ├─ websocket.js           TTS WebSocket 来源检查和双向转发
│  ├─ proxy.js               装配各处理器，分派路由并管理启动和关闭
│  └─ transform.js           上游 HTML、CSS 和入口 bundle 的字符串改写
├─ scripts/
│  ├─ build-client.mjs       用 esbuild 构建页面入口
│  ├─ check.mjs              递归检查源码语法，并校验页面构建产物
│  ├─ test.mjs               同进程加载 node:test 测试，兼容受限环境
│  └─ dev-proxy.mjs          复用共享配置的独立开发代理
├─ test/                     本地单元和集成测试
├─ docs/configuration.md     配置和 JSON 字段说明
├─ cordis.patch.yml          启用 bundle 时插入 Host 插件行
├─ market/entry.yml          市场仓库的提交条目草稿
├─ package.json              npm 入口、打包清单和 Harness 元数据
├─ screenshots.json          市场展示的截图路径
└─ locale/                   中英文插件标题和简介
```

运行时，浏览器页面先向 Harness 查询状态、提交同步请求，再访问 `127.0.0.1` 上的代理 iframe；
代理使用 Cookie 罐访问 DeepSeek 上游，并把改写后的网页和资源返回浏览器。
新增命名函数时请用通俗中文写清楚输入、输出和必要的副作用。JSON 不支持注释，字段解释统一放到
[配置说明](docs/configuration.md)，不要在 JSON 里加入 `//` 或 `/* */`。

## 已知限制 / Limits

- 代理固定绑定 `127.0.0.1`，会检查请求的 `Origin`；同一台机器的其他进程仍可能访问该端口。
- DeepSeek 自己的深浅色主题独立于 Harness 主题，无法自动继承 Harness 的主题令牌。
- Google、Apple 等登录流程可能要求顶层窗口或正式站点域名。可先试标题栏的「在浏览器中打开」，
  必须在 `deepseek.com` 完成的登录请用「同步登录态」导入。
- Cookie、待同步凭据和浏览器存储都应当作登录凭据保管；上游过期、登出、撤销权限或清理浏览器存储后可能需要重新登录。
- 上游前端随时可能变化。若入口脚本字符串匹配失效，Host 日志会打印 `entry bundle patterns missing: …`，
  需要检查并更新 [src/transform.js](src/transform.js)。
