/** 插槽注册和字典注册使用同一个命名空间。 */
export const NS = 'deepseekChat';

/** 翻译服务尚未就绪时使用英文文案。 */
const DEFAULTS = {
  'action.open': 'DeepSeek chat',
  'panel.title': 'DeepSeek chat',
  'panel.subtitle': 'Served by the local Host proxy · login is kept by the Host',
  'panel.reload': 'Reload',
  'panel.external': 'Open in browser',
  'panel.close': 'Close',
  'panel.connecting': 'Connecting to chat.deepseek.com…',
  'panel.unavailable': 'The local proxy is not ready yet.',
  'panel.retry': 'Retry',
  'panel.hint': 'Sign in inside this panel once; the session is kept on the Host.',
  'panel.sync': 'Import login',
  'panel.sync.title': 'Import a login from the real site',
  'panel.sync.intro':
    'The WeChat QR only works on deepseek.com itself, so a WeChat account can sign in on the real site and hand the session over here. Credentials pass through the local Host into the proxied page and are used to authenticate requests to DeepSeek.',
  'panel.sync.step1': '1. On a tab where chat.deepseek.com is already signed in, open DevTools (F12) and switch to Console.',
  'panel.sync.step2': '2. Run this line; it copies your session credentials to the clipboard:',
  'panel.sync.step3': '3. Paste the clipboard content below, then choose “Import and reload”.',
  'panel.sync.copy': 'Copy code',
  'panel.sync.copied': 'Copied',
  'panel.sync.placeholder': 'Paste {"token":"…","id":…}, or just the token',
  'panel.sync.submit': 'Import and reload',
  'panel.sync.busy': 'Importing…',
  'panel.sync.cancel': 'Cancel',
  'panel.sync.failed': 'Import failed: ',
  'panel.sync.restartHint': ' The new Host code is not active yet — restart the Harness (dsh web), then refresh this page.',
  'panel.sync.invalid': 'No credentials found in that text.',
};

/** 保留原面板的中英文键名，让两个插槽都能通过 locale 服务取词。 */
export const zh = {
  'action.open': 'DeepSeek 对话',
  'panel.title': 'DeepSeek 对话',
  'panel.subtitle': '由本机 Host 代理提供 · 登录状态保存在 Host',
  'panel.reload': '重新加载',
  'panel.external': '在浏览器中打开',
  'panel.close': '关闭',
  'panel.connecting': '正在连接 chat.deepseek.com…',
  'panel.unavailable': '本机代理尚未就绪。',
  'panel.retry': '重试',
  'panel.hint': '在本面板内登录一次即可，会话会保存在 Host 上。',
  'panel.sync': '同步登录态',
  'panel.sync.title': '从正式站点同步登录态',
  'panel.sync.intro':
    '微信扫码只能在 deepseek.com 域名下完成，所以用微信登录的账号可以先在正式站点登录，再把会话交给这个面板。凭据会经过本机 Host 传入代理页面，并用于向 DeepSeek 发送请求时的身份验证。',
  'panel.sync.step1': '1. 在已登录 chat.deepseek.com 的标签页按 F12，切换到 Console。',
  'panel.sync.step2': '2. 粘贴并运行下面这一行，它会把登录凭据复制到剪贴板：',
  'panel.sync.step3': '3. 把剪贴板内容粘贴到下面，然后点“同步并刷新”。',
  'panel.sync.copy': '复制代码',
  'panel.sync.copied': '已复制',
  'panel.sync.placeholder': '粘贴 {"token":"…","id":…}，或直接粘贴 token',
  'panel.sync.submit': '同步并刷新',
  'panel.sync.busy': '正在同步…',
  'panel.sync.cancel': '取消',
  'panel.sync.failed': '同步失败：',
  'panel.sync.restartHint': '新的 Host 端代码还没生效，请重启 Harness（dsh web）后刷新本页面。',
  'panel.sync.invalid': '没有识别出登录凭据。',
};

export const en = { ...DEFAULTS };

/**
 * 先读取 Harness 翻译，服务还没绑定或返回空值时使用内置英文文案。
 *
 * @param {((key: string, params?: object) => unknown) | undefined} t Harness 翻译函数。
 * @param {string} key 文案键名。
 * @param {object} [params] 文案的插值参数。
 * @returns {string} 最终显示的文案，未知键名会原样返回。
 */
export function translate(t, key, params) {
  if (typeof t === 'function') {
    try {
      const text = t(key, params);
      if (typeof text === 'string' && text !== '') return text;
    } catch {
      // 字典服务短暂不可用时，仍然能显示按钮和错误提示。
    }
  }
  return DEFAULTS[key] ?? key;
}
