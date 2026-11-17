/** 使用临时状态目录和假上游，验证本地代理的边界和真实响应行为。 */
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import zlib from 'node:zlib';
import { createDeepSeekProxy } from '../src/proxy.js';
import { createSyncHandler } from '../src/host-routes.js';
import { LoginStore } from '../src/login-store.js';
import { readDevProxyConfig } from '../scripts/dev-proxy.mjs';

/**
 * 为测试提供隔离状态目录，结束时只删除刚创建的目录。
 * @param {import('node:test').TestContext} t 当前测试上下文。
 * @returns {Promise<string>} 临时目录的完整路径。
 */
async function temporaryState(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-proxy-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('dsh-proxy-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

/**
 * 发送一个本地HTTP请求并收集原始响应，避免fetch自动解压掩盖响应头问题。
 * @param {string} url 请求完整地址。
 * @param {object} [options={}] method、headers、body等选项。
 * @returns {Promise<{status: number, headers: object, body: string}>} 收集好的响应。
 */
function requestLocal(url, { body = '', ...options } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('代理并发启动、同步校验、超限、Origin与关闭均能正常处理', async (t) => {
  const stateDir = await temporaryState(t);
  const proxy = createDeepSeekProxy({ port: 0, stateDir });
  t.after(() => proxy.close());
  await Promise.all([proxy.start(), proxy.start()]);
  assert.equal(proxy.running, true);
  const base = proxy.url;
  assert.equal((await requestLocal(`${base}__ds/health`)).status, 200);
  assert.equal((await requestLocal(`${base}__ds/health`, { headers: { origin: 'https://outside.example' } })).status, 403);
  assert.equal((await requestLocal(`${base}__ds/sync`, { method: 'POST', body: '{"token":"demo"}', headers: { 'content-type': 'application/json', origin: 'http://localhost:3080' } })).status, 200);
  assert.equal(proxy.pendingLogin, true);
  assert.equal((await requestLocal(`${base}__ds/sync`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await requestLocal(`${base}__ds/sync`, { method: 'POST', body: 'a'.repeat(65537) })).status, 413);
  // 旧页面发来的确认不能删掉后排队的新token。
  await requestLocal(`${base}__ds/sync/ack`, { method: 'POST' });
  assert.equal(proxy.pendingLogin, true);
  await Promise.all([proxy.close(), proxy.close()]);
  assert.equal(proxy.url, null);
  assert.equal(proxy.port, 0);
  assert.equal(proxy.running, false);
  const saved = JSON.parse(await fs.readFile(path.join(stateDir, 'pending-sync.json'), 'utf8'));
  assert.equal(saved.token, 'demo');
});

test('首选端口占用会换端口，关闭期间启动也能释放干净', async (t) => {
  const stateDir = await temporaryState(t);
  const blocker = http.createServer();
  blocker.listen(0, '127.0.0.1');
  await once(blocker, 'listening');
  t.after(() => new Promise((resolve) => blocker.close(resolve)));
  const port = blocker.address().port;
  const proxy = createDeepSeekProxy({ port, stateDir });
  t.after(() => proxy.close());
  await proxy.start();
  assert.notEqual(proxy.port, port);
  await proxy.close();
  const starting = proxy.start();
  const closing = proxy.close();
  await Promise.all([starting, closing]);
  assert.equal(proxy.running, false);
});

test('WebSocket外站Origin在接触上游前被拒绝', async (t) => {
  const proxy = createDeepSeekProxy({ port: 0, stateDir: await temporaryState(t) });
  t.after(() => proxy.close());
  await proxy.start();
  const socket = net.connect(proxy.port, '127.0.0.1');
  t.after(() => socket.destroy());
  let response = '';
  socket.on('data', (chunk) => { response += chunk.toString(); });
  socket.write('GET /api/v0/chat/tts/ HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nOrigin: https://outside.example\r\n\r\n');
  await once(socket, 'end');
  assert.match(response, /403 Forbidden/);
});

test('登录态排队与删除按序写盘，旧快照不会删掉新凭据', async (t) => {
  const file = path.join(await temporaryState(t), 'pending-sync.json');
  const store = new LoginStore(file, () => {});
  store.queue('first');
  const first = store.pending;
  store.queue('second');
  store.clear(first);
  await store.flush();
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).token, 'second');
  store.clear(store.pending);
  store.queue('third');
  await store.flush();
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).token, 'third');
});

test('Host同源同步handler共享校验、限制请求体和拒绝外站来源', async (t) => {
  const login = new LoginStore(path.join(await temporaryState(t), 'pending-sync.json'), () => {});
  const proxy = { queueLogin: (value) => login.queue(value), pendingLogin: false, running: true, url: 'http://127.0.0.1:1/' };
  const server = http.createServer(createSyncHandler(proxy, () => {}));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); await login.flush(); });
  const url = `http://127.0.0.1:${server.address().port}/`;
  assert.equal((await requestLocal(url, { method: 'POST', body: 'demo' })).status, 200);
  assert.equal((await requestLocal(url, { method: 'POST', body: 'a'.repeat(65537) })).status, 413);
  assert.equal((await requestLocal(url, { method: 'POST', body: 'demo', headers: { origin: 'https://outside.example' } })).status, 403);
  assert.equal((await requestLocal(url, { method: 'DELETE' })).status, 405);
});

test('开发配置严格校验CLI，支持0并覆盖环境端口', () => {
  assert.equal(readDevProxyConfig(['0'], { DSH_DEEPSEEK_CHAT_PORT: '3100' }).port, 0);
  assert.equal(readDevProxyConfig([], { DSH_DEEPSEEK_CHAT_PORT: '3100' }).port, 3100);
  for (const port of ['3097abc', '-1', '0.5', '65536', '']) assert.throws(() => readDevProxyConfig([port], {}));
});

test('压缩资源改写后移除编码与旧摘要，HTML注入和API流式响应仍正常', async (t) => {
  const stateDir = await temporaryState(t);
  const calls = [];
  // 假上游仅替换https请求，所有本地HTTP请求仍通过真实监听端口。
  t.mock.method(https, 'request', (options, callback) => {
    calls.push(options);
    const request = new EventEmitter();
    request.destroy = () => {};
    request.end = () => queueMicrotask(() => {
      const asset = options.host === 'fe-static.deepseek.com';
      const streaming = options.path.startsWith('/api/');
      const text = asset ? 'h.p="https://fe-static.deepseek.com/chat/"' : streaming ? 'data: chunk\n\n' : '<html><head></head><body></body></html>';
      const buffer = streaming ? Buffer.from(text) : zlib.gzipSync(text);
      const response = Readable.from([buffer]);
      response.statusCode = 200;
      response.headers = {
        'content-type': asset ? 'application/javascript' : streaming ? 'text/event-stream' : 'text/html',
        ...(streaming ? {} : { 'content-encoding': 'gzip', etag: 'upstream-hash' }),
      };
      callback(response);
    });
    return request;
  });
  const logs = [];
  const proxy = createDeepSeekProxy({ stateDir, port: 0, debug: true, log: (_level, message) => logs.push(message) });
  t.after(() => proxy.close());
  await proxy.start();
  const asset = await requestLocal(`${proxy.url}__ds/main.abc.js?v=1`);
  assert.equal(asset.headers['content-encoding'], undefined);
  assert.equal(asset.headers.etag, undefined);
  assert.match(asset.body, /window.location.origin/);
  proxy.queueLogin('dummy-token');
  const html = await requestLocal(proxy.url, { headers: { authorization: 'Bearer dummy-secret' } });
  assert.match(html.body, /data-dsh-deepseek-sync/);
  assert.equal(proxy.pendingLogin, true, '文档刚发出时必须保留凭据');
  const syncId = JSON.parse(html.body.match(/var d=([^;]+);/)[1]).syncId;
  assert.match(html.body, new RegExp(syncId));
  await requestLocal(`${proxy.url}__ds/sync/ack`, { method: 'POST', body: JSON.stringify({ syncId: 'stale-id' }) });
  assert.equal(proxy.pendingLogin, true, '旧文档确认不能清理新凭据');
  await requestLocal(`${proxy.url}__ds/sync/ack`, { method: 'POST', body: JSON.stringify({ syncId }) });
  assert.equal(proxy.pendingLogin, false);
  const stream = await requestLocal(`${proxy.url}api/chat`);
  assert.equal(stream.body, 'data: chunk\n\n');
  assert.ok(logs.some((line) => line.includes('auth=present')));
  assert.ok(logs.every((line) => !line.includes('dummy-secret')));
  assert.equal(calls.filter((call) => call.host === 'fe-static.deepseek.com').length, 1);
});
