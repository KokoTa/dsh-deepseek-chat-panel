# 配置和清单字段说明

本插件把可调配置集中在 [src/config.js](../src/config.js)。Host 入口和独立开发代理都复用
`readProxyConfig(env = process.env)`，避免各自维护一套默认值。JSON 文件保持标准 JSON 格式，
不添加 `//` 或 `/* */`；需要了解字段含义时看本文。

## 代理配置从哪里来

`readProxyConfig` 的输入是环境变量对象，默认使用当前进程的 `process.env`；返回以下四个字段：

| 返回字段 | 类型 | 作用 |
| --- | --- | --- |
| `host` | 字符串 | 固定为 `127.0.0.1`，只在本机回环地址监听 |
| `port` | 数字 | 已检查的首选端口，范围为 `1..65535` 的整数 |
| `stateDir` | 字符串 | 存放 Cookie 和待同步登录态的目录 |
| `debug` | 布尔值 | 是否输出上游请求调试日志 |

绑定地址不提供环境变量开关。不要增加或配置 `DSH_DEEPSEEK_CHAT_HOST` 来尝试对外监听。

| 环境变量 | 未设置或为空时的行为 | 设置后做什么 |
| --- | --- | --- |
| `DSH_DEEPSEEK_CHAT_PORT` | 使用 `3097` | 指定首选端口；非整数、小于 `1`、大于 `65535` 或 `3097abc` 之类混合文本都无效，回退到 `3097` |
| `DSH_DEEPSEEK_CHAT_STATE` | Host 使用 `<DSH_HOME>/deepseek-chat` | 指定状态目录，前后空白会去掉 |
| `DSH_DEEPSEEK_CHAT_DEBUG` | 关闭调试日志 | 只有文本 `1` 开启，`true`、`0` 等其他值不开启；鉴权只记录 `present` / `none` |
| `DSH_HOME` | 使用用户主目录下的 `.dsh` | 在没有单独设置状态目录时，用它拼出 `deepseek-chat` 子目录 |

环境变量中的端口 `0` 会回退到 `3097`。首选端口被占用时，代理会改用系统分配的空闲端口。
页面通过 `GET /plugins/deepseek-chat/status` 取得实际 URL，所以不应把首选端口当作最终地址。

### 在 PowerShell 中设置

下面的变量只影响当前终端和从中启动的子进程；请从同一个终端启动 Harness，修改后重启已有 Host 进程。

```powershell
# 首选端口，正常配置范围是 1..65535。
$env:DSH_DEEPSEEK_CHAT_PORT = '3100'

# Host 状态目录，可以是自己的绝对路径。
$env:DSH_DEEPSEEK_CHAT_STATE = 'D:\MyCodes\test\deepseek\dsh-deepseek-chat\.cache\state'

# 调试时设 1，排查完可设 0 关闭。
$env:DSH_DEEPSEEK_CHAT_DEBUG = '1'

dsh web
```

这些入口**不会自动读取 `.env` 文件**。单独创建 `.env` 不会改变配置，需要由终端或外部工具把值放进进程环境。
调试日志记录请求方法、路径、Cookie 数量，以及鉴权头是否存在：`auth=present` 或 `auth=none`。
它不会输出 `Authorization` 的内容或片段。

### 独立开发代理的优先级

[scripts/dev-proxy.mjs](../scripts/dev-proxy.mjs) 提供 `readDevProxyConfig(argv, env)`：
输入为去掉 Node 和脚本路径后的参数列表、环境变量对象；输出仍是 `{ host, port, stateDir, debug }`。
导入该函数本身不会启动服务。直接运行脚本或执行 `npm run dev` 时才启动代理。

开发入口的规则如下：

1. 先调用共享的 `readProxyConfig(env)`，沿用固定地址、端口和调试开关。
2. 没有设置有效的 `DSH_DEEPSEEK_CHAT_STATE` 时，状态目录改用**项目目录**下的 `.cache/state`，
   与从哪个工作目录运行脚本无关。即使设置了 `DSH_HOME`，开发默认目录也还是 `.cache/state`。
3. 传了 CLI 端口，就用它覆盖环境变量端口。CLI 允许 `0..65535` 的十进制整数，`0` 让系统自动分配端口。
   小数、负数、混合文本、超出范围的值、空参数和多余参数都会报错退出。

```powershell
# 先在 dsh-deepseek-chat 项目目录运行。
$env:DSH_DEEPSEEK_CHAT_PORT = '3100'

# 采用环境变量的首选端口 3100。
npm run dev

# CLI 优先，使用 3200。
npm run dev -- 3200

# CLI 优先，让系统分配空闲端口；不受环境变量 3100 影响。
npm run dev -- 0
```

终端打印的 `probe-url` 是实际可访问地址。`Ctrl+C` 会关闭服务并保存 Cookie。
开发代理只复用 Host 代理，不提供完整的 Harness 侧栏界面，也不注册 Harness 的同源路由。

## 状态文件和登录态流向

状态目录由上述配置决定，不要把真实 Cookie 或 token 提交到仓库。

| 状态数据 | 保存在哪里 | 用途和生命周期 |
| --- | --- | --- |
| Cookie 罐 | 状态目录的 `cookies.json` | Host 收集上游 `Set-Cookie`，后续请求自动带上；可跨重启保存 |
| 待同步登录态 | 状态目录的 `pending-sync.json` | 等待文档注入并收到匹配 `syncId` 的成功确认后清理；未确认时跨重启保留，供后续加载重试 |
| 已注入登录态 | 代理来源的浏览器 `localStorage` | `userToken` 和 `__appKit_userInfo`，由代理页脚本写入；清理浏览器存储或更换代理来源会影响这份数据 |

通常的同步路径是：Harness 面板 → 同源 `POST /plugins/deepseek-chat/sync` → 本机 Host 队列和状态文件 →
下一次代理文档中的注入脚本 → 代理页的 `localStorage`。同源路由不可用时，页面保留向代理
`POST /__ds/sync` 提交的备用路径；独立开发代理也使用这个接口。凭据经过本机 Host，后续访问
DeepSeek 上游时会用于正常鉴权。同步本身不直接改 Cookie 罐，接口也不提供凭据读取功能。

代理为每份待同步项生成随机 `syncId`，发出带注入脚本的 HTML 后继续保留凭据。只有脚本成功写入
`localStorage`，才会向 `POST /__ds/sync/ack` 发送 JSON 确认体 `{ "syncId": "本次同步标识" }`。
代理核对它与当前待同步项的 `syncId` 一致后，才清理对应凭据和状态文件。

如果写入或确认失败，凭据会保留，供下一次文档加载重试。旧页面发送的空回执仍可兼容，但不会清理凭据；
旧 `syncId` 同样不会清理当前项，因此迟到的确认不会删除后来排队的新 token。确认响应只返回是否还有待同步状态，不返回凭据。

## npm 包清单

[package.json](../package.json) 同时服务于 npm、Node.js 和 Harness。这里说明现有字段，
不要把端口或登录凭据加到清单里。

### 基本信息

| 字段 | 含义 |
| --- | --- |
| `name` | npm 安装名称，这个包叫 `dsh-deepseek-chat-panel`；本地目录叫 `dsh-deepseek-chat` 也可以 |
| `version` | npm 包版本，发布新包时按版本规则更新 |
| `description` | npm 和工具看到的简短功能描述 |
| `type` | `module` 表示本包的 `.js` 使用 ESM 的 `import` / `export` |
| `main` | 默认 Host 入口是 `index.js` |
| `repository`、`homepage`、`bugs` | 源码、说明页和问题反馈地址 |
| `keywords`、`license` | 搜索关键词与 MIT 许可证声明 |
| `icon` | 插件包内的图标路径 `./icon.svg`，不是市场条目的远程 PNG 图标 |

### exports：允许别人从哪里导入

`exports` 定义包对外公开的入口。没有列出的内部文件不要当作稳定 API 使用。

| 导出键 | 对应文件 | 用途 |
| --- | --- | --- |
| `.` | `./index.js` | Host 插件入口，导出 `apply(ctx)` |
| `./client` | `./client.js` | 已构建的浏览器入口，保留 `window.__ModuleLoader__.load` 加载协议 |
| `./locale/*.json` | `./locale/*.json` | 暴露匹配的语言 JSON 数据 |
| `./icon` | `./icon.svg` | 暴露包内图标 |
| `./package.json` | `./package.json` | 允许工具读取包元数据 |

### files：npm 包里装哪些文件

`files` 是发布内容清单，列出 Host 入口、生成的页面入口、`src`、`scripts`、bundle patch、
语言数据、图标、截图资源、截图清单和文档等。npm 还会按自己的规则保留必要的包信息与许可证。
源码目录保留清晰的维护结构；运行时页面从根目录 `client.js` 加载，不直接逐个请求 `src/client` 模块。

新增发布所需的文件时同步核对这份清单。依赖、缓存目录和真实状态数据不应成为插件资源。
发布前可以在项目目录运行 `npm pack --dry-run` 查看将包含的文件。

### engines：运行环境要求

`engines.node` 指定 Node.js `>=20`。`engines.dsh` 声明兼容的 Harness 版本范围：

```text
>=0.2.1-rc.1 <0.2.2-0 || >=0.2.2-rc.1 <0.2.3-0
```

`||` 表示满足任一段范围即可；这不是自动支持所有未来版本的承诺。改动 Harness API 后，
应先在目标版本验证，再调整版本范围。

### dsh：bundle 和页面插件声明

| 字段 | 含义 |
| --- | --- |
| `dsh.bundle.patch` | 启用 bundle 时应用的 `./cordis.patch.yml`，为 Host 插入插件行 |
| `dsh.client.platform` | `web` 表示只在 Harness 网页端加载 |
| `dsh.client.immediately` | `true` 表示页面插件在依赖满足后立即启用 |
| `dsh.client.inject` | 页面插件需要 Harness 提供的依赖名称列表，不是 npm 运行时依赖清单 |

当前 `inject` 包括 `@deepseek-ai/dsh-client-locale` 和 `@deepseek-ai/dsh-client-ui-slots`，
分别提供语言能力和 UI 插槽。页面使用 Harness 提供的 React 和插槽，把按钮、浮层放进现有界面。
构建时不要再把另一份 React 打进生成文件。

### scripts、开发依赖和发布设置

| 字段或命令 | 作用 |
| --- | --- |
| `devDependencies.esbuild` | 只在开发构建时使用的打包器，不是已构建插件的运行时依赖 |
| `scripts.build` / `npm run build` | 用 esbuild 把页面 ESM 源码生成根目录 `client.js` |
| `scripts.check` / `npm run check` | 运行 `scripts/check.mjs`，递归检查源码语法，再校验生成入口是否与页面源码一致 |
| `scripts.test` / `npm test` | 运行项目的本地测试 |
| `scripts.dev` / `npm run dev` | 单独启动开发代理，可追加一个端口参数 |
| `publishConfig.access` | `public` 表示 npm 包按公开包发布；本字段不会自动执行发布 |

从仓库安装开发依赖使用 `npm ci`，再执行 `npm run build`、`npm run check` 和 `npm test`。
修改 [src/client](../src/client/) 后重新构建并提交根目录的生成文件。发布清单和包脚本可能随着维护调整，
实际值以当前 [package.json](../package.json) 为准。

## bundle patch 和市场条目

[cordis.patch.yml](../cordis.patch.yml) 中的 `insert` 在启用 bundle 时插入 Host 插件行。
`id: deepseek-chat` 是 profile 内该行的标识，`name: dsh-deepseek-chat-panel` 是要加载的 npm 包。
两者用途不同，修改包名时要同步修改 `name`。

[market/entry.yml](../market/entry.yml) 是准备提交到市场仓库的草稿，修改它不会发布 npm 包或自动上架。

| 字段 | 含义 |
| --- | --- |
| `url` | 插件源码仓库的公开 URL，要与真实仓库一致 |
| `name` | 市场标识，使用 `owner/repo`，和 npm 名称不是同一个字段 |
| `category` | 市场支持的分类，这里是 `browser` |
| `description.en`、`description.zh` | 市场列表里的英文和中文简介，应准确描述当前功能 |
| `icon` | 市场使用的远程图片链接，这里使用仓库托管的 `assets/icon-180.png` |

提交路径与审核规则以市场仓库当前要求为准。市场简介、语言元数据和 README 描述同一功能，改功能时记得一起核对。

## 截图 JSON 和语言 JSON

[screenshots.json](../screenshots.json) 的顶层 `screenshots` 是按顺序排列的图片路径数组：

| 路径 | 展示内容 |
| --- | --- |
| `assets/screenshot-panel.png` | 面板整体 |
| `assets/screenshot-login.png` | 登录界面 |
| `assets/screenshot-sync.png` | 登录态同步界面 |

路径相对于插件包根目录。增删或重命名截图时，同时维护截图清单和发布资源；截图中不要包含真实登录凭据。

[locale/zh.json](../locale/zh.json) 和 [locale/en.json](../locale/en.json) 提供中文、英文元数据：

| 字段 | 含义 |
| --- | --- |
| `meta.title` | 插件标题，中文为「DeepSeek 对话面板」，英文为「DeepSeek chat panel」 |
| `meta.description` | 插件简介，说明本机 Host 代理和登录状态保留能力 |

这两个 JSON 文件只包含可翻译数据。按钮和弹窗文案由页面源码中的语言逻辑处理。
增加或调整 JSON 字段时保留有效 JSON，字段说明继续写在本文，不把注释混进数据里。
