/**
 * 创建一个面板显隐状态，让侧栏按钮和覆盖层可以读写同一份数据。
 * 每次加载插件都会创建新状态，不会把上一次加载的订阅者带进来。
 *
 * @returns {{getOpen: () => boolean, setOpen: (next: boolean) => void, subscribe: (listener: () => void) => () => boolean}}
 *   当前显隐状态的读取、更新和订阅方法。
 */
export function createPanelState() {
  let open = false;
  const listeners = new Set();

  /**
   * 读取当前显隐状态，不触发界面更新。
   *
   * @returns {boolean} 面板是否打开。
   */
  function getOpen() {
    return open;
  }

  /**
   * 订阅显隐变化；组件卸载时调用返回的函数即可取消订阅。
   *
   * @param {() => void} listener 状态变化后调用的回调。
   * @returns {() => boolean} 取消订阅的方法，返回是否成功移除。
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  /**
   * 更新显隐状态并通知订阅者；单个回调出错不会影响其他组件。
   *
   * @param {boolean} next 是否打开面板。
   * @returns {void} 相同状态直接忽略，其余情况通知当前订阅者。
   */
  function setOpen(next) {
    if (open === next) return;
    open = next;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // 一个插槽刷新失败时，另一个插槽仍然可以跟随显隐状态刷新。
      }
    }
  }

  return { getOpen, setOpen, subscribe };
}

/**
 * 创建 React 使用的显隐状态 Hook，React 由 Harness 传入，避免打包第二份 React。
 *
 * @param {object} React Harness 页面使用的 React 模块。
 * @param {ReturnType<typeof createPanelState>} state 当前插件实例的共享显隐状态。
 * @returns {() => boolean} 组件每次渲染时读取面板显隐状态的 Hook。
 */
export function createUseOpen(React, state) {
  /**
   * 订阅共享状态，让两个独立插槽的组件一起刷新。
   *
   * @returns {boolean} 面板当前是否打开。
   */
  function useOpen() {
    const [visible, setVisible] = React.useState(state.getOpen());
    React.useEffect(() => state.subscribe(() => setVisible(state.getOpen())), []);
    return visible;
  }

  return useOpen;
}
