/**
 * Host half of the DeepSeek chat panel.
 *
 * The Host owns the loopback proxy (`src/proxy.js`): it is the only place that can
 * hold the DeepSeek session cookies on disk and strip the framing policy, and it
 * survives page reloads and Harness restarts. The page half (`client.js`) only needs
 * the proxy URL, which this plugin publishes on the Harness web server so the browser
 * learns the actual port (the proxy falls back to a free one when 3097 is taken).
 *
 * Environment overrides:
 *  - `DSH_DEEPSEEK_CHAT_PORT`  preferred loopback port (default 3097)
 *  - `DSH_DEEPSEEK_CHAT_STATE` state directory for `cookies.json`
 *    (default `<DSH_HOME>/deepseek-chat`, i.e. `~/.dsh/deepseek-chat`)
 */

import os from 'node:os';
import path from 'node:path';

import { createDeepSeekProxy } from './src/proxy.js';

/** Harness route the page half reads to discover the proxy origin. */
const STATUS_ROUTE = '/plugins/deepseek-chat/status';

/**
 * Harness route the page half posts a pasted login token to.
 *
 * It lives on the Harness web server (same origin as the page) on purpose: the
 * page embeds the proxy from a different loopback port, so posting straight to
 * `http://127.0.0.1:3097/__ds/sync` is a cross-origin request whose failures the
 * browser reports as an opaque `TypeError: Failed to fetch`. Asking this route
 * instead keeps the request same-origin and lets the Host forward it.
 */
const SYNC_ROUTE = '/plugins/deepseek-chat/sync';

/** Largest pasted credential body accepted by {@link SYNC_ROUTE}. */
const SYNC_BODY_LIMIT = 64 * 1024;

/** Upper-cased plugin tag for log lines. */
const TAG = '[deepseek-chat]';

/**
 * Host plugin body: start the proxy for the lifetime of the entry and publish its URL.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx Entry context.
 */
export function apply(ctx) {
  const log = (level, message) => {
    const line = `${TAG} ${message}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  };

  const home = process.env.DSH_HOME?.trim() || path.join(os.homedir(), '.dsh');
  const stateDir = process.env.DSH_DEEPSEEK_CHAT_STATE?.trim() || path.join(home, 'deepseek-chat');
  const requestedPort = Number.parseInt(process.env.DSH_DEEPSEEK_CHAT_PORT ?? '', 10);
  const proxy = createDeepSeekProxy({
    stateDir,
    port: Number.isFinite(requestedPort) ? requestedPort : undefined,
    log: (level, message) => log(level, message),
  });

  ctx.effect(() => {
    let disposed = false;
    proxy
      .start()
      .then(() => {
        if (disposed) void proxy.close();
      })
      .catch((error) => log('error', `proxy failed to start: ${error?.message ?? error}`));
    return () => {
      disposed = true;
      void proxy.close();
    };
  }, 'deepseek-chat: loopback proxy');

  ctx.inject(['webServer'], (scope) => {
    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: STATUS_ROUTE,
          resource: async () =>
            new Response(
              JSON.stringify({
                ok: true,
                url: proxy.url,
                running: proxy.running,
                cookies: proxy.cookieCount,
                pendingLogin: proxy.pendingLogin,
              }),
              {
                status: 200,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                },
              },
            ),
        }),
      'deepseek-chat: status route',
    );

    scope.effect(
      () =>
        scope.webServer.register({
          kind: 'exact',
          path: SYNC_ROUTE,
          resource: async (request) => {
            const json = (status, payload) =>
              new Response(JSON.stringify(payload), {
                status,
                headers: {
                  'content-type': 'application/json; charset=utf-8',
                  'cache-control': 'no-store',
                },
              });
            const method = (request.method ?? 'GET').toUpperCase();
            if (method === 'OPTIONS') {
              return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
            }
            if (method === 'GET') {
              return json(200, { ok: true, pending: proxy.pendingLogin, running: proxy.running });
            }
            if (method !== 'POST') return json(405, { ok: false, error: 'method not allowed' });

            let text = '';
            try {
              text = await request.text();
            } catch (error) {
              return json(400, { ok: false, error: `unreadable body: ${error?.message ?? error}` });
            }
            if (text.length > SYNC_BODY_LIMIT) return json(413, { ok: false, error: 'body too large' });

            let payload = text.trim();
            if (payload.startsWith('{') || payload.startsWith('"')) {
              try {
                payload = JSON.parse(payload);
              } catch {
                // Keep the raw text: normalizeSyncPayload accepts a bare token too.
              }
            }
            const queued = proxy.queueLogin(payload);
            if (!queued.ok) return json(400, queued);
            log('info', 'queued a login token from the Harness route');
            return json(200, { ok: true, pending: true, url: proxy.url });
          },
        }),
      'deepseek-chat: sync route',
    );
  });
}
