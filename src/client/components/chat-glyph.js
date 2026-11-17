/**
 * 创建聊天气泡图标组件；使用 Harness 传入的 React，不包含另一份运行时。
 *
 * @param {object} React Harness 页面使用的 React 模块。
 * @returns {({size}: {size?: number}) => object} 只负责渲染 SVG 的组件。
 */
export function createChatGlyph(React) {
  const h = React.createElement;

  /**
   * 渲染侧栏和面板标题使用的聊天气泡图标。
   *
   * @param {{size?: number}} props 图标尺寸，默认 16 像素。
   * @returns {object} React SVG 元素。
   */
  function ChatGlyph({ size = 16 }) {
    return h(
      'svg',
      {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      },
      h('path', { d: 'M4.2 5.4h15.6v9.4H9.6l-4.2 3.4v-3.4H4.2z' }),
      h('path', { d: 'M8.4 10.1h7.2' }),
    );
  }

  return ChatGlyph;
}
