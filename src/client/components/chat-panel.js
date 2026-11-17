import { translate } from '../locales.js';

/**
 * 创建面板组件，将共享显隐状态、API 和子组件接在一起。
 *
 * @param {object} React Harness 页面使用的 React 模块。
 * @param {{state: object, useOpen: () => boolean, api: object, ChatGlyph: Function, SyncDialog: Function}} dependencies
 *   共享状态、订阅 Hook、API、图标和登录态同步弹窗。
 * @returns {(props: {t?: Function}) => object | null} 可注册到覆盖层插槽的 React 组件。
 */
export function createChatPanel(React, { state, useOpen, api, ChatGlyph, SyncDialog }) {
  const h = React.createElement;

  /**
   * 渲染 DeepSeek 覆盖层；首次打开后保留 iframe，关闭再打开不丢失会话。
   *
   * @param {{t?: Function}} props Harness 翻译函数。
   * @returns {object | null} 首次打开前返回 null，之后返回可以隐藏的面板元素。
   */
  function ChatPanel(props) {
    const visible = useOpen();
    const t = props.t;
    const [origin, setOrigin] = React.useState(null);
    const [failure, setFailure] = React.useState(null);
    const [reloadKey, setReloadKey] = React.useState(0);
    const [wasOpened, setWasOpened] = React.useState(false);
    const [syncOpen, setSyncOpen] = React.useState(false);

    // 只在第一次打开前不渲染，关闭面板后仍保留 iframe 和内部对话。
    React.useEffect(() => {
      if (visible) setWasOpened(true);
    }, [visible]);

    /**
     * 清除错误并重新查询代理地址，成功后刷新 iframe。
     *
     * @returns {void} 查询结果通过地址或失败状态触发界面刷新。
     */
    const attempt = React.useCallback(() => {
      setFailure(null);
      api.resolveOrigin()
        .then((value) => {
          setOrigin(value);
          setReloadKey((key) => key + 1);
        })
        .catch(() => setFailure(true));
    }, []);

    React.useEffect(() => {
      if (!visible || origin) return;
      attempt();
    }, [visible, origin, attempt]);

    React.useEffect(() => {
      if (!visible) return undefined;

      /**
       * 面板打开时响应 Escape 键，关闭时会移除这个监听。
       *
       * @param {KeyboardEvent} event 页面收到的键盘事件。
       * @returns {void} Escape 键会把共享显隐状态设为关闭。
       */
      const onKeyDown = (event) => {
        if (event.key === 'Escape') state.setOpen(false);
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }, [visible]);

    if (!wasOpened) return null;
    const source = origin ? `${origin}/` : null;

    return h(
      'div',
      {
        className: 'dsh-deepseek-chat-backdrop',
        style: visible ? undefined : { display: 'none' },
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) state.setOpen(false);
        },
      },
      h(
        'section',
        {
          className: 'dsh-deepseek-chat-card',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translate(t, 'panel.title'),
        },
        h(
          'header',
          { className: 'dsh-deepseek-chat-head' },
          h(ChatGlyph, { size: 16 }),
          h('div', { className: 'dsh-deepseek-chat-heading' },
            h('span', { className: 'dsh-deepseek-chat-title' }, translate(t, 'panel.title')),
            h('span', { className: 'dsh-deepseek-chat-sub' }, source ?? translate(t, 'panel.connecting')),
          ),
          h('span', { className: 'dsh-deepseek-chat-spacer' }),
          source
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-deepseek-chat-btn',
                  onClick: () => window.open(source, '_blank', 'noopener,noreferrer'),
                },
                translate(t, 'panel.external'),
              )
            : null,
          source
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-deepseek-chat-btn',
                  onClick: () => setReloadKey((key) => key + 1),
                },
                translate(t, 'panel.reload'),
              )
            : null,
          source
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'dsh-deepseek-chat-btn',
                  onClick: () => setSyncOpen(true),
                },
                translate(t, 'panel.sync'),
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-deepseek-chat-btn',
              onClick: () => state.setOpen(false),
            },
            translate(t, 'panel.close'),
          ),
        ),
        h(
          'div',
          { className: 'dsh-deepseek-chat-body' },
          source
            ? h('iframe', {
                key: `${source}#${reloadKey}`,
                className: 'dsh-deepseek-chat-frame',
                src: source,
                title: translate(t, 'panel.title'),
                sandbox:
                  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals',
                allow: 'clipboard-read; clipboard-write',
                referrerPolicy: 'no-referrer',
              })
            : h(
                'div',
                { className: 'dsh-deepseek-chat-empty' },
                h('span', null, failure ? translate(t, 'panel.unavailable') : translate(t, 'panel.connecting')),
                failure
                  ? h(
                      'button',
                      { type: 'button', className: 'dsh-deepseek-chat-btn', onClick: attempt },
                      translate(t, 'panel.retry'),
                    )
                  : null,
                failure ? h('span', { className: 'dsh-deepseek-chat-hint' }, translate(t, 'panel.hint')) : null,
              ),
          syncOpen && source
            ? h(SyncDialog, {
                t,
                origin: source,
                onClose: () => setSyncOpen(false),
                onApplied: () => {
                  setSyncOpen(false);
                  setReloadKey((key) => key + 1);
                },
              })
            : null,
        ),
      ),
    );
  }

  return ChatPanel;
}
