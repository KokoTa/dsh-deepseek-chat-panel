/** 面板样式统一使用 Harness 主题变量；iframe 内部的 DeepSeek 页面保留自己的样式。 */
export const STYLES = `
.dsh-deepseek-chat-trigger { display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: 0; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.dsh-deepseek-chat-trigger:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-trigger[data-active="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-brand-primary); }
.dsh-deepseek-chat-trigger--rail { width: 28px; height: 28px; padding: 0; }
.dsh-deepseek-chat-trigger--wide { width: 100%; min-height: 28px; padding: 4px 8px; justify-content: flex-start; font-size: 13px; }
.dsh-deepseek-chat-trigger-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsh-deepseek-chat-backdrop { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--dsw-alias-bg-mask-1, rgba(0, 0, 0, 0.35)); pointer-events: auto; }
.dsh-deepseek-chat-card { display: flex; flex-direction: column; width: min(1180px, 96vw); height: min(860px, 90vh); overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-base); box-shadow: 0 24px 64px rgba(0, 0, 0, 0.32); }
.dsh-deepseek-chat-head { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 8px 0 14px; border-bottom: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-heading { display: flex; flex-direction: column; min-width: 0; }
.dsh-deepseek-chat-title { font-size: 13px; font-weight: 600; line-height: 1.3; }
.dsh-deepseek-chat-sub { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; line-height: 1.3; color: var(--dsw-alias-label-tertiary); }
.dsh-deepseek-chat-spacer { flex: 1; }
.dsh-deepseek-chat-btn { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; }
.dsh-deepseek-chat-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-body { position: relative; flex: 1; min-height: 0; background: var(--dsw-alias-bg-base); }
.dsh-deepseek-chat-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: #ffffff; }
.dsh-deepseek-chat-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; height: 100%; padding: 24px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-secondary); }
.dsh-deepseek-chat-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dsh-deepseek-chat-btn--primary { border-color: var(--dsw-alias-brand-primary); background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); }
.dsh-deepseek-chat-btn:disabled { opacity: 0.55; cursor: default; }
.dsh-deepseek-chat-sync { position: absolute; inset: 0; z-index: 5; display: flex; align-items: center; justify-content: center; padding: 16px; background: var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, 0.45)); }
.dsh-deepseek-chat-sync-card { display: flex; flex-direction: column; gap: 8px; width: min(560px, 100%); max-height: 100%; overflow: auto; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 12px; line-height: 1.5; }
.dsh-deepseek-chat-sync-title { font-size: 13px; font-weight: 600; }
.dsh-deepseek-chat-sync-line { margin: 0; color: var(--dsw-alias-label-secondary); }
.dsh-deepseek-chat-sync-code { display: flex; align-items: flex-start; gap: 8px; padding: 8px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-base); }
.dsh-deepseek-chat-sync-code code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--dsw-alias-label-primary); }
.dsh-deepseek-chat-sync-input { min-height: 84px; resize: vertical; padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; }
.dsh-deepseek-chat-sync-error { margin: 0; color: var(--dsw-alias-danger-primary, #d24b4b); }
.dsh-deepseek-chat-sync-actions { display: flex; justify-content: flex-end; gap: 8px; }
`;

/**
 * 将样式挂到页面上，并返回给 ctx.effect 用的清理方法。
 *
 * @param {Document} pageDocument 当前浏览器页面的 document。
 * @returns {() => void} 插件停用时删除 style 标签的方法。
 */
export function installStyles(pageDocument) {
  const style = pageDocument.createElement('style');
  style.setAttribute('data-plugin', 'dsh-deepseek-chat-panel');
  style.textContent = STYLES;
  pageDocument.head.appendChild(style);
  return () => style.remove();
}
