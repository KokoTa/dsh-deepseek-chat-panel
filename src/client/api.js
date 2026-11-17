/** Harness 提供的状态接口，与当前页面同源。 */
const STATUS_ROUTE = '/plugins/deepseek-chat/status';
/** 优先使用同源入口提交凭据，代理端口变化时也不受影响。 */
const SYNC_ROUTE = '/plugins/deepseek-chat/sync';

/** 在正式站点 Console 执行，把已有会话的 token 和用户 id 复制出来。 */
export const SYNC_SNIPPET =
  'copy(JSON.stringify({token:JSON.parse(localStorage.userToken).value,id:(JSON.parse(localStorage["__appKit_userInfo"]).value||{}).id}))';

/**
 * 把粘贴的文本转成 Host 接受的 JSON 数据；兼容直接粘贴 token。
 *
 * @param {string} text 已去掉首尾空白的登录凭据。
 * @returns {unknown} 能解析时保留 JSON 原值，否则返回带 token 的对象。
 */
export function parseCredentials(text) {
  try {
    return text.startsWith('{') ? JSON.parse(text) : { token: text };
  } catch {
    return { token: text };
  }
}

/**
 * 把网络错误转成弹窗里的提示，网络失败时附上当前代理地址。
 *
 * @param {unknown} cause 提交失败时收到的异常。
 * @param {string} origin 当前代理地址，用于说明哪个地址无法访问。
 * @returns {string} 可以直接显示的错误说明。
 */
export function formatSyncError(cause, origin) {
  return cause && (cause.name === 'TypeError' || /failed to fetch/i.test(String(cause.message)))
    ? `Failed to fetch (${origin})`
    : String(cause?.message ?? cause);
}

/**
 * 创建客户端 API，缓存成功的代理地址；失败后允许下次重新请求。
 * fetch 由入口传入，方便检查同源提交和旧版 Host 的回退行为。
 *
 * @param {typeof fetch} request 浏览器的 fetch 方法。
 * @returns {{resolveOrigin: () => Promise<string>, syncCredentials: (text: string, origin: string) => Promise<unknown>}}
 *   查询代理地址和同步登录凭据的方法。
 */
export function createClientApi(request) {
  /** @type {Promise<string> | null} 同一个插件实例只保留一次成功的状态请求。 */
  let originRequest = null;

  /**
   * 查询 Host 已启动的代理地址，并去掉结尾斜杠。
   *
   * @returns {Promise<string>} 代理地址；状态接口失败或没有地址时拒绝。
   * @throws {Error} HTTP 状态异常、代理尚未启动或网络请求失败。
   */
  function resolveOrigin() {
    if (originRequest) return originRequest;
    originRequest = request(STATUS_ROUTE, { headers: { accept: 'application/json' }, cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((payload) => {
        const url = payload && typeof payload.url === 'string' ? payload.url : '';
        if (!url) throw new Error('proxy not started');
        return url.replace(/\/$/, '');
      })
      .catch((error) => {
        originRequest = null;
        throw error;
      });
    return originRequest;
  }

  /**
   * 向一个同步入口提交凭据；仅 404/405 表示旧版入口缺失，可以回退。
   *
   * @param {string} url 要提交的 HTTP 地址。
   * @param {unknown} body 发送给 Host 的 JSON 数据。
   * @returns {Promise<unknown>} 服务端 JSON 响应。
   * @throws {{fallback: boolean} | Error} 入口缺失带 fallback 标记，其余错误附上状态码。
   */
  function postCredentials(url, body) {
    return request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((response) => {
      if (response.ok) return response.json();
      if (response.status === 404 || response.status === 405) {
        return Promise.reject({ fallback: true });
      }
      return response
        .json()
        .catch(() => ({}))
        .then((payload) => {
          throw new Error(payload?.error ? `${response.status} ${payload.error}` : String(response.status));
        });
    });
  }

  /**
   * 把登录凭据交给同源 Host；旧版 Host 缺少入口时才改用代理的同步接口。
   *
   * @param {string} text 已去掉首尾空白的粘贴文本。
   * @param {string} origin 当前状态接口给出的代理地址，不能假设端口固定。
   * @returns {Promise<unknown>} 同步接口的 JSON 响应；提交失败时拒绝。
   */
  function syncCredentials(text, origin) {
    const body = parseCredentials(text);
    return postCredentials(SYNC_ROUTE, body).catch((cause) => {
      if (cause && cause.fallback) return postCredentials(`${String(origin).replace(/\/$/, '')}/__ds/sync`, body);
      throw cause;
    });
  }

  return { resolveOrigin, syncCredentials };
}
