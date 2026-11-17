import { createPlugin } from './plugin.js';

/**
 * 按 Harness 的 ModuleLoader 协议创建插件，只从宿主获取 React。
 *
 * @param {(id: string) => object} require Harness 提供的模块读取函数。
 * @returns {ReturnType<typeof createPlugin>} 注册插槽和词典的页面插件。
 */
function factory(require) {
  return createPlugin(require('react'));
}

// 源码使用 ESM 管理依赖，构建后仍通过原来的页面加载协议注册。
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-chat-panel',
  factory,
});
