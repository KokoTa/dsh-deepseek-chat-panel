import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

import { createClientApi } from '../src/client/api.js';
import { createPanelState } from '../src/client/state.js';

/**
 * 创建假的 JSON 响应，所有 API 测试只调用本地替身，不会提交真实凭据。
 *
 * @param {unknown} payload 接口返回的 JSON 数据。
 * @param {number} [status=200] HTTP 状态码。
 * @returns {Response} 可以交给客户端 API 处理的响应。
 */
function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
}

const proxyOrigin = 'http://127.0.0.1:4312';
const statusRoute = '/plugins/deepseek-chat/status';
const syncRoute = '/plugins/deepseek-chat/sync';

test('面板状态实例互不影响，相同状态不会重复通知', () => {
  const first = createPanelState();
  const second = createPanelState();
  const firstChanges = [];
  const secondChanges = [];
  first.subscribe(() => firstChanges.push(first.getOpen()));
  second.subscribe(() => secondChanges.push(second.getOpen()));

  assert.equal(first.getOpen(), false);
  assert.equal(second.getOpen(), false);
  first.setOpen(true);
  first.setOpen(true);
  assert.equal(first.getOpen(), true);
  assert.equal(second.getOpen(), false);
  assert.deepEqual(firstChanges, [true]);
  assert.deepEqual(secondChanges, []);

  second.setOpen(true);
  first.setOpen(false);
  assert.equal(second.getOpen(), true);
  assert.deepEqual(firstChanges, [true, false]);
  assert.deepEqual(secondChanges, [true]);
});

test('面板取消订阅后不再通知，其他订阅者继续收到更新', () => {
  const state = createPanelState();
  let removedCalls = 0;
  let activeCalls = 0;
  const unsubscribe = state.subscribe(() => removedCalls++);
  state.subscribe(() => activeCalls++);
  state.setOpen(true);
  assert.equal(removedCalls, 1);
  assert.equal(activeCalls, 1);
  assert.equal(unsubscribe(), true);
  assert.equal(unsubscribe(), false);

  state.setOpen(false);
  assert.equal(removedCalls, 1);
  assert.equal(activeCalls, 2);
});

test('面板监听异常不阻断后续监听，也不影响最终状态', () => {
  const state = createPanelState();
  const changes = [];
  state.subscribe(() => {
    throw new Error('模拟失效的插槽');
  });
  state.subscribe(() => changes.push(state.getOpen()));

  assert.doesNotThrow(() => state.setOpen(true));
  assert.doesNotThrow(() => state.setOpen(false));
  assert.equal(state.getOpen(), false);
  assert.deepEqual(changes, [true, false]);
});

test('状态接口合并并发请求并缓存成功地址，不跨 API 实例共享缓存', async () => {
  const requests = [];
  const request = async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ url: `${proxyOrigin}/` });
  };
  const api = createClientApi(request);
  const first = api.resolveOrigin();
  assert.equal(api.resolveOrigin(), first);
  assert.equal(await first, proxyOrigin);
  assert.equal(await api.resolveOrigin(), proxyOrigin);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, statusRoute);
  assert.equal(requests[0].options.cache, 'no-store');
  assert.equal(requests[0].options.headers.accept, 'application/json');

  assert.equal(await createClientApi(request).resolveOrigin(), proxyOrigin);
  assert.equal(requests.length, 2);
});

test('状态接口失败后下次可以重新请求，成功后继续缓存', async (context) => {
  const failures = [
    { name: 'HTTP 错误', respond: () => jsonResponse({}, 503), error: /503/ },
    { name: '响应缺少地址', respond: () => jsonResponse({}), error: /proxy not started/ },
    { name: 'JSON 无法解析', respond: () => new Response('{broken'), error: SyntaxError },
    { name: '网络错误', respond: () => Promise.reject(new TypeError('Failed to fetch')), error: /Failed to fetch/ },
  ];
  for (const { name, respond, error } of failures) {
    await context.test(name, async () => {
      let attempts = 0;
      const api = createClientApi(async () => ++attempts === 1 ? respond() : jsonResponse({ url: proxyOrigin }));
      const first = api.resolveOrigin();
      assert.equal(api.resolveOrigin(), first);
      await assert.rejects(first, error);
      assert.equal(await api.resolveOrigin(), proxyOrigin);
      assert.equal(await api.resolveOrigin(), proxyOrigin);
      assert.equal(attempts, 2);
    });
  }
});

test('登录同步优先提交同源 Host，成功后不再访问代理入口', async () => {
  const requests = [];
  const api = createClientApi(async (url, options) => {
    requests.push({ url, options });
    return jsonResponse({ ok: true });
  });
  assert.deepEqual(await api.syncCredentials('{"token":"sample-token","id":12}', proxyOrigin), { ok: true });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, syncRoute);
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(requests[0].options.body), { token: 'sample-token', id: 12 });
});

for (const status of [404, 405]) {
  test(`登录同步收到 ${status} 才回退到当前代理地址，并原样重发凭据`, async () => {
    const requests = [];
    const api = createClientApi(async (url, options) => {
      requests.push({ url, options });
      return requests.length === 1 ? jsonResponse({}, status) : jsonResponse({ ok: true });
    });
    assert.deepEqual(await api.syncCredentials('sample-token', `${proxyOrigin}/`), { ok: true });
    assert.deepEqual(requests.map(({ url }) => url), [syncRoute, `${proxyOrigin}/__ds/sync`]);
    for (const { options } of requests) {
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(options.body), { token: 'sample-token' });
    }
    assert.equal(requests[1].options.body, requests[0].options.body);
  });
}

for (const status of [400, 403, 500]) {
  test(`登录同步收到 ${status} 时保留服务端错误，不回退到代理`, async () => {
    const requests = [];
    const api = createClientApi(async (url) => {
      requests.push(url);
      return jsonResponse({ error: 'denied' }, status);
    });
    await assert.rejects(api.syncCredentials('sample-token', proxyOrigin), { message: `${status} denied` });
    assert.deepEqual(requests, [syncRoute]);
  });
}

test('登录同步网络失败时不额外向代理发送凭据', async () => {
  const requests = [];
  const failure = new TypeError('Failed to fetch');
  const api = createClientApi(async (url) => {
    requests.push(url);
    throw failure;
  });
  await assert.rejects(api.syncCredentials('sample-token', proxyOrigin), (error) => error === failure);
  assert.deepEqual(requests, [syncRoute]);
});

test('已构建客户端通过 ModuleLoader 加载，仅依赖宿主 React 并注册两个根插槽', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const definitions = [];
  // 不提供 DOM 或 ESM 加载器：产物必须能够直接作为页面脚本注册。
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (definition) => definitions.push(definition) } },
  });
  assert.equal(definitions.length, 1);
  const definition = definitions[0];
  assert.equal(definition.id, 'dsh-deepseek-chat-panel');
  assert.equal(typeof definition.factory, 'function');

  const required = [];
  const elements = [];
  const hostReact = {
    createElement: (type, props, ...children) => {
      const element = { type, props, children };
      elements.push(element);
      return element;
    },
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
  };
  const plugin = definition.factory((id) => {
    required.push(id);
    assert.equal(id, 'react', '只能从宿主获取 React');
    return hostReact;
  });
  assert.deepEqual(required, ['react']);
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'locale']);

  const effects = [];
  const injections = [];
  const slots = [];
  plugin.apply({
    effect: (effect, label) => effects.push({ effect, label }),
    slots: {
      inject: (name, register) => {
        injections.push(name);
        register();
      },
      register: (options, component) => slots.push({ options, component }),
    },
  });
  assert.deepEqual(injections, ['sidebar.footer.action', 'shell.overlay']);
  assert.deepEqual(slots.map(({ options }) => ({ ...options })), [
    { name: 'sidebar.footer.action', id: 'deepseek-chat', locale: 'deepseekChat', order: 10 },
    { name: 'shell.overlay', id: 'deepseek-chat-panel', locale: 'deepseekChat', order: 40 },
  ]);
  assert.ok(slots.every(({ component }) => typeof component === 'function'));
  assert.equal(effects.length, 2);

  // 实际渲染侧栏按钮，确认工厂返回的组件使用传入的 React 创建元素。
  const button = slots[0].component({ wide: true });
  assert.equal(button.type, 'button');
  assert.equal(button.props['aria-pressed'], 'false');
  assert.equal(button.props['aria-label'], 'DeepSeek chat');
  assert.ok(elements.includes(button));
  assert.deepEqual(required, ['react']);
});
