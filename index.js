/** Host 入口只装配配置、代理生命周期和 Harness 路由，具体功能在 src 中。 */
import { readProxyConfig } from './src/config.js';
import { registerHostRoutes } from './src/host-routes.js';
import { createDeepSeekProxy } from './src/proxy.js';

/**
 * 输出带插件标记的日志，方便在 Host 日志中定位。
 * @param {string} level 日志级别，error/warn 分别走对应的控制台方法。
 * @param {string} message 已去掉凭据的日志内容。
 * @returns {void} 输出一行日志。
 */
function log(level, message) {
  const line = `[deepseek-chat] ${message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * 启用 Host 插件，卸载时关闭代理并解除路由注册。
 * @param {import('@deepseek-ai/cordis').Context} ctx Cordis 插件上下文。
 * @returns {void} 具体生命周期由 ctx.effect 管理。
 */
export function apply(ctx) {
  const proxy = createDeepSeekProxy({ ...readProxyConfig(), log });
  ctx.effect(() => {
    let disposed = false;
    void proxy.start()
      .then(() => { if (disposed) return proxy.close(); })
      .catch((error) => log('error', `代理启动失败：${error?.message ?? error}`));
    return () => {
      disposed = true;
      void proxy.close();
    };
  }, 'deepseek-chat: loopback proxy');
  ctx.inject(['webServer'], (scope) => registerHostRoutes(scope, proxy, log));
}
