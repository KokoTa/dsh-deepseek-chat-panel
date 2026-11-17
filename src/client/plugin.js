import { createClientApi } from './api.js';
import { createChatGlyph } from './components/chat-glyph.js';
import { createChatPanel } from './components/chat-panel.js';
import { createFooterAction } from './components/footer-action.js';
import { createSyncDialog } from './components/sync-dialog.js';
import { en, NS, zh } from './locales.js';
import { createPanelState, createUseOpen } from './state.js';
import { installStyles } from './styles.js';

/**
 * 装配插件实例；两个根插槽共用显隐状态，API 缓存只属于这一次加载。
 *
 * @param {object} React ModuleLoader 从 Harness 取出的 React 模块。
 * @returns {{inject: string[], apply: (ctx: object) => void}} Harness 可加载的页面插件。
 */
export function createPlugin(React) {
  const state = createPanelState();
  const useOpen = createUseOpen(React, state);
  const api = createClientApi((...args) => fetch(...args));
  const ChatGlyph = createChatGlyph(React);
  const SyncDialog = createSyncDialog(React, api);
  const FooterAction = createFooterAction(React, { state, useOpen, ChatGlyph });
  const ChatPanel = createChatPanel(React, { state, useOpen, api, ChatGlyph, SyncDialog });

  /**
   * 注册词典、样式、侧栏开关和面板覆盖层，生命周期清理由 Harness 接管。
   *
   * @param {object} ctx Harness 插件上下文，提供 effect、locale 和 slots 服务。
   * @returns {void} 注册完成后由插槽系统渲染组件。
   */
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'deepseek-chat: dictionaries');
    ctx.effect(() => installStyles(document), 'deepseek-chat: styles');
    ctx.slots.inject('sidebar.footer.action', () =>
      ctx.slots.register({ name: 'sidebar.footer.action', id: 'deepseek-chat', locale: NS, order: 10 }, FooterAction),
    );
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'deepseek-chat-panel', locale: NS, order: 40 }, ChatPanel),
    );
  }

  return { inject: ['slots', 'locale'], apply };
}
