import { translate } from '../locales.js';

/**
 * 创建侧栏按钮组件，并让它与面板使用同一份显隐状态。
 *
 * @param {object} React Harness 页面使用的 React 模块。
 * @param {{state: object, useOpen: () => boolean, ChatGlyph: Function}} dependencies
 *   共享状态、订阅 Hook 和聊天图标组件。
 * @returns {(props: {t?: Function, wide?: boolean}) => object} 可注册到侧栏插槽的组件。
 */
export function createFooterAction(React, { state, useOpen, ChatGlyph }) {
  const h = React.createElement;

  /**
   * 渲染侧栏底部的面板开关；窄栏显示图标，宽栏同时显示文字。
   *
   * @param {{t?: Function, wide?: boolean}} props Harness 翻译函数和宽版布局标志。
   * @returns {object} 带显隐状态和辅助说明的 React 按钮元素。
   */
  function FooterAction(props) {
    const visible = useOpen();
    const label = translate(props.t, 'action.open');
    const wide = props.wide === true;
    return h(
      'button',
      {
        type: 'button',
        className: `dsh-deepseek-chat-trigger ${wide ? 'dsh-deepseek-chat-trigger--wide' : 'dsh-deepseek-chat-trigger--rail'}`,
        'data-active': visible ? 'true' : 'false',
        title: label,
        'aria-label': label,
        'aria-pressed': visible ? 'true' : 'false',
        onClick: () => state.setOpen(!state.getOpen()),
      },
      h(ChatGlyph, { size: wide ? 16 : 18 }),
      wide ? h('span', { className: 'dsh-deepseek-chat-trigger-label' }, label) : null,
    );
  }

  return FooterAction;
}
