/** Harness 同源路由：页面在这里查代理地址、提交登录凭据。 */
import { HOST_SYNC_ROUTE, STATUS_ROUTE, SYNC_BODY_LIMIT } from './config.js';
import { isLoopbackOrigin, sendJson, readBody } from './http.js';

/**
 * 生成代理状态的资源函数。
 * @param {object} proxy 代理实例，只读取公开的状态字段。
 * @returns {() => Promise<Response>} 返回 JSON 状态的 Harness 资源函数。
 */
function createStatusResource(proxy) {
  return async () => new Response(JSON.stringify({
    ok: true, url: proxy.url, running: proxy.running,
    cookies: proxy.cookieCount, pendingLogin: proxy.pendingLogin,
  }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/**
 * 创建登录态同步处理器。请求体校验由代理统一完成，不在路由里重复解析 token。
 * @param {object} proxy 提供 queueLogin 和状态字段的代理实例。
 * @param {(level: string, message: string) => void} log 日志函数，不接收凭据内容。
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} HTTP 处理器。
 */
export function createSyncHandler(proxy, log) {
  return async (req, res) => {
    try {
      if (req.headers.origin && !isLoopbackOrigin(req.headers.origin)) {
        sendJson(res, 403, { ok: false, error: 'cross-origin request rejected' });
        return;
      }
      const method = (req.method ?? 'GET').toUpperCase();
      const allow = { allow: 'GET, HEAD, POST, OPTIONS' };
      if (method === 'OPTIONS') {
        res.writeHead(204, { ...allow, 'cache-control': 'no-store' });
        res.end();
        return;
      }
      if (method === 'GET' || method === 'HEAD') {
        sendJson(res, 200, { ok: true, pending: proxy.pendingLogin, running: proxy.running });
        return;
      }
      if (method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'method not allowed' }, allow);
        return;
      }
      const body = await readBody(req, SYNC_BODY_LIMIT);
      const queued = proxy.queueLogin(body.toString('utf8'));
      if (!queued.ok) {
        sendJson(res, 400, queued);
        return;
      }
      log('info', '已从 Harness 同步路由收到登录态');
      sendJson(res, 200, { ok: true, pending: true, url: proxy.url });
    } catch (error) {
      const status = error?.code === 'BODY_TOO_LARGE' ? 413 : 500;
      sendJson(res, status, { ok: false, error: status === 413 ? 'body too large' : `sync route failed: ${error?.message ?? error}` });
    }
  };
}

/**
 * 把两个路由绑定到 Harness，卸载时由 effect 自动解除注册。
 * @param {object} scope 提供 webServer 和 effect 的 Cordis 作用域。
 * @param {object} proxy 代理实例。
 * @param {(level: string, message: string) => void} log 日志函数。
 * @returns {void} 通过副作用注册路由。
 */
export function registerHostRoutes(scope, proxy, log) {
  scope.effect(() => scope.webServer.register({
    kind: 'exact', path: STATUS_ROUTE, resource: createStatusResource(proxy),
  }), 'deepseek-chat: status route');
  scope.effect(() => scope.webServer.register({
    kind: 'exact', path: HOST_SYNC_ROUTE,
    // resource 只接收 GET/HEAD；登录态提交需要 POST，所以使用原始 handler。
    handler: createSyncHandler(proxy, log),
  }), 'deepseek-chat: sync route');
}
