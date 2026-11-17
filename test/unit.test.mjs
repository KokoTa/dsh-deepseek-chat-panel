import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import vm from 'node:vm';

import { readProxyConfig } from '../src/config.js';
import { CookieJar, mergeCookies } from '../src/cookies.js';
import { decodeBody, isAllowedOrigin, requestPath, responseHeaders } from '../src/http.js';
import { injectSyncScript, normalizeSyncPayload, parseSyncBody } from '../src/sync.js';
import { patchEntryBundle, rewriteCss, rewriteHtml } from '../src/transform.js';

test('配置读取会校验端口并生成状态目录', () => {
  const config = readProxyConfig(
    {
      DSH_HOME: 'C:/dsh',
      DSH_DEEPSEEK_CHAT_PORT: 'not-a-port',
      DSH_DEEPSEEK_CHAT_DEBUG: '1',
    },
  );
  assert.equal(config.port, 3097);
  assert.equal(config.stateDir, path.join('C:/dsh', 'deepseek-chat'));
  assert.equal(config.debug, true);
  for (const port of ['3097abc', '-1', '0', '65536', '1.2']) {
    assert.equal(readProxyConfig({ DSH_DEEPSEEK_CHAT_PORT: port }).port, 3097);
  }
  assert.equal(readProxyConfig({ DSH_DEEPSEEK_CHAT_HOST: '0.0.0.0' }).host, '127.0.0.1');
});

test('登录态解析只接受有限长度且不含换行的 token', () => {
  assert.deepEqual(normalizeSyncPayload('{"token":"abc","id":12}'), { token: 'abc', id: '12' });
  assert.deepEqual(parseSyncBody(Buffer.from('abc'), 'text/plain'), { token: 'abc', id: null });
  assert.equal(normalizeSyncPayload('a\nb'), null);
  assert.equal(normalizeSyncPayload({ token: ' ' }), null);
});

test('登录态脚本会安全注入 HTML', () => {
  const html = injectSyncScript('<html><head></head><body></body></html>', { token: '<safe>', id: null });
  assert.match(html, /data-dsh-deepseek-sync/);
  assert.doesNotMatch(html, /<safe>/);
});

test('登录态脚本只在浏览器存储写入成功后发送对应回执', () => {
  const html = injectSyncScript('<head></head>', { token: 'demo', id: null, syncId: 'current-id' });
  const script = html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
  for (const fail of [false, true]) {
    const acks = [];
    vm.runInNewContext(script, {
      localStorage: { setItem() { if (fail) throw new Error('storage denied'); } },
      document: { documentElement: { setAttribute() {} } },
      fetch: (url, options) => { acks.push({ url, options }); return Promise.resolve(); },
    });
    assert.equal(acks.length, fail ? 0 : 1);
    if (!fail) assert.deepEqual(JSON.parse(acks[0].options.body), { syncId: 'current-id' });
  }
});

test('Cookie 会合并、落盘，并过滤敏感 Set-Cookie', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-deepseek-'));
  t.after(async () => {
    assert.equal(path.dirname(dir), os.tmpdir());
    assert.ok(path.basename(dir).startsWith('dsh-deepseek-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'cookies.json');
  const jar = new CookieJar(file, () => {}, 250);
  jar.absorb(['session=one; Path=/; HttpOnly; Secure', 'theme=dark; Path=/']);
  await Promise.all([jar.save(), jar.flush()]);
  assert.equal(jar.header(), 'session=one; theme=dark');
  assert.equal(mergeCookies('theme=light; browser=yes', jar.header()), 'theme=dark; browser=yes; session=one');
  const stored = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(stored.cookies.session, 'one');
});

test('HTTP 工具会规范路径、来源和响应头', () => {
  assert.equal(requestPath('https://chat.deepseek.com/api?q=1'), '/api?q=1');
  assert.equal(isAllowedOrigin('http://127.0.0.1:3097', 'http://127.0.0.1:3097'), true);
  assert.equal(isAllowedOrigin('https://evil.example', 'http://127.0.0.1:3097'), false);
  const headers = responseHeaders(
    {
      'content-type': 'text/html',
      'content-security-policy': "frame-ancestors 'none'",
      location: 'https://chat.deepseek.com/login',
      'set-cookie': ['theme=dark; Path=/'],
    },
    { origin: 'http://127.0.0.1:3097' },
  );
  assert.equal(headers['content-security-policy'], undefined);
  assert.equal(headers.location, 'http://127.0.0.1:3097/login');
  assert.deepEqual(headers['set-cookie'], ['theme=dark; Path=/']);
});

test('叠加压缩编码按逆序解开，未知编码明确报错', () => {
  const source = Buffer.from('代理压缩测试');
  assert.deepEqual(decodeBody(zlib.brotliCompressSync(zlib.gzipSync(source)), 'gzip, br'), source);
  assert.throws(() => decodeBody(source, 'unknown'), /unsupported content-encoding/);
});

test('页面资源改写和入口 bundle 改写会报告命中项', () => {
  const html = rewriteHtml('<script src="https://fe-static.deepseek.com/chat/main.js"></script>', 'http://127.0.0.1:3097');
  assert.equal(html.replaced, 1);
  assert.match(html.html, /http:\/\/127\.0\.0\.1:3097\/__ds\/main\.js/);
  assert.equal(rewriteCss('a{background:url(https://fe-static.deepseek.com/chat/a.png)}').replaced, 1);
  const patched = patchEntryBundle(
    'let e=location.hostname;if(e.match(/(\\d{1,3}\\.){3,3}\\d{1,3}/))return"dev";h.p="https://fe-static.deepseek.com/chat/"',
  );
  assert.deepEqual(patched.applied, ['environment', 'public-path']);
  assert.deepEqual(patched.missing, ['hostname-fallback', 'tts-websocket-scheme']);
});
