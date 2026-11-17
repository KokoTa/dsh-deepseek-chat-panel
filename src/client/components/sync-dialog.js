import { formatSyncError, SYNC_SNIPPET } from '../api.js';
import { translate } from '../locales.js';

/**
 * 创建登录态同步弹窗组件，网络提交交给独立 API 处理。
 *
 * @param {object} React Harness 页面使用的 React 模块。
 * @param {{syncCredentials: (text: string, origin: string) => Promise<unknown>}} api 当前插件实例的 API。
 * @returns {(props: object) => object} 供面板显示的登录态同步组件。
 */
export function createSyncDialog(React, api) {
  const h = React.createElement;

  /**
   * 接收从正式站点复制的 token/id，成功后通知父组件刷新 iframe。
   *
   * @param {{t?: Function, origin: string, onClose: () => void, onApplied: () => void}} props
   *   翻译函数、代理地址、关闭回调和同步成功回调。
   * @returns {object} 带说明、粘贴区和操作按钮的 React 弹窗元素。
   */
  function SyncDialog({ t, origin, onClose, onApplied }) {
    const [text, setText] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const [error, setError] = React.useState(null);

    /**
     * 校验文本后开始提交；空白文本和正在进行的请求会直接忽略。
     *
     * @returns {void} 提交结果通过成功回调或界面错误状态反馈。
     */
    const submit = React.useCallback(() => {
      const value = text.trim();
      if (!value || busy) return;
      setBusy(true);
      setError(null);
      api.syncCredentials(value, origin)
        .then(() => onApplied())
        .catch((cause) => {
          setBusy(false);
          setError(formatSyncError(cause, origin));
        });
    }, [text, busy, origin, onApplied]);

    /**
     * 复制正式站点 Console 代码，权限失败时恢复为未复制状态。
     *
     * @returns {void} 剪贴板结果只更新复制按钮文字。
     */
    const copy = React.useCallback(() => {
      try {
        void navigator.clipboard
          .writeText(SYNC_SNIPPET)
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      } catch {
        setCopied(false);
      }
    }, []);

    return h(
      'div',
      { className: 'dsh-deepseek-chat-sync' },
      h(
        'div',
        {
          className: 'dsh-deepseek-chat-sync-card',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': translate(t, 'panel.sync.title'),
        },
        h('div', { className: 'dsh-deepseek-chat-sync-title' }, translate(t, 'panel.sync.title')),
        h('p', { className: 'dsh-deepseek-chat-sync-line' }, translate(t, 'panel.sync.intro')),
        h('p', { className: 'dsh-deepseek-chat-sync-line' }, translate(t, 'panel.sync.step1')),
        h('p', { className: 'dsh-deepseek-chat-sync-line' }, translate(t, 'panel.sync.step2')),
        h(
          'div',
          { className: 'dsh-deepseek-chat-sync-code' },
          h('code', null, SYNC_SNIPPET),
          h(
            'button',
            { type: 'button', className: 'dsh-deepseek-chat-btn', onClick: copy },
            translate(t, copied ? 'panel.sync.copied' : 'panel.sync.copy'),
          ),
        ),
        h('p', { className: 'dsh-deepseek-chat-sync-line' }, translate(t, 'panel.sync.step3')),
        h('textarea', {
          className: 'dsh-deepseek-chat-sync-input',
          value: text,
          spellCheck: false,
          placeholder: translate(t, 'panel.sync.placeholder'),
          onChange: (event) => setText(event.target.value),
        }),
        error
          ? h(
              'p',
              { className: 'dsh-deepseek-chat-sync-error' },
              translate(t, 'panel.sync.failed') +
                error +
                (/40[134]/.test(error) || /failed to fetch/i.test(error)
                  ? translate(t, 'panel.sync.restartHint')
                  : ''),
            )
          : null,
        h(
          'div',
          { className: 'dsh-deepseek-chat-sync-actions' },
          h(
            'button',
            { type: 'button', className: 'dsh-deepseek-chat-btn', onClick: onClose, disabled: busy },
            translate(t, 'panel.sync.cancel'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'dsh-deepseek-chat-btn dsh-deepseek-chat-btn--primary',
              onClick: submit,
              disabled: busy || text.trim() === '',
            },
            translate(t, busy ? 'panel.sync.busy' : 'panel.sync.submit'),
          ),
        ),
      ),
    );
  }

  return SyncDialog;
}
