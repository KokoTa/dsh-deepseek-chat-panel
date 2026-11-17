/**
 * Loopback reverse proxy in front of `https://chat.deepseek.com`.
 *
 * Why a proxy at all: the site sends `content-security-policy: frame-ancestors 'none'`
 * (so it cannot be framed directly), and its session cookie is `HttpOnly; Secure;
 * SameSite=Strict`. Running the page from a loopback origin the Host controls lets
 * the Host strip the framing policy and hold the login cookies in a file, so the
 * pane keeps its session across Harness restarts and browser changes.
 *
 * Responsibilities:
 *  - serve the upstream document with the framing headers removed and its asset
 *    URLs pointed at this origin;
 *  - serve the patched entry bundle (see `transform.js`) and rewritten stylesheets;
 *  - pass every other asset through from the CDN untouched;
 *  - proxy `/api/*` (streaming responses included) and WebSocket upgrades, absorbing
 *    `Set-Cookie` into the jar and injecting `Cookie` upstream;
 *  - publish nothing: binding is loopback only and each request is checked against a
 *    cross-site `Origin` header before it reaches the upstream.
 */

import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

import { LOCAL_PREFIX, patchEntryBundle, rewriteCss, rewriteHtml } from './transform.js';

const UPSTREAM_ORIGIN = 'https://chat.deepseek.com';
const UPSTREAM_HOST = 'chat.deepseek.com';
const CDN_ORIGIN = 'https://fe-static.deepseek.com';
const DEFAULT_PORT = 3097;
const ASSET_CACHE_TTL_MS = 10 * 60 * 1000;
const ASSET_CACHE_ENTRIES = 96;
const JAR_SAVE_DEBOUNCE_MS = 250;
const SYNC_PATH = `${LOCAL_PREFIX}sync`;
const SYNC_ACK_PATH = `${LOCAL_PREFIX}sync/ack`;
const SYNC_BODY_LIMIT = 64 * 1024;
const TOKEN_LIMIT = 8192;
const DEBUG = process.env.DSH_DEEPSEEK_CHAT_DEBUG === '1';

/** Hop-by-hop headers plus the browser security policy headers a framed app must not inherit. */
const STRIP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'cross-origin-resource-policy',
  'strict-transport-security',
  'expect-ct',
  'nel',
  'alt-svc',
  'report-to',
  'reporting-endpoints',
  'permissions-policy',
  'server',
]);

const HOP_REQUEST_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'cookie',
  'origin',
  'referer',
  'accept-encoding',
  'if-none-match',
  'if-modified-since',
]);

/** Persisted cookie jar for the upstream origin. */
class CookieJar {
  /**
   * @param {string} file Absolute path of the JSON jar.
   * @param {(level: string, message: string) => void} log Diagnostic sink.
   */
  constructor(file, log) {
    this.file = file;
    this.log = log;
    /** @type {Map<string, string>} */
    this.cookies = new Map();
    this.loaded = false;
    /** @type {NodeJS.Timeout | undefined} */
    this.timer = undefined;
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = JSON.parse(await fsp.readFile(this.file, 'utf8'));
      const stored = raw && typeof raw === 'object' && raw.cookies ? raw.cookies : raw;
      if (stored && typeof stored === 'object') {
        for (const [name, value] of Object.entries(stored)) {
          if (typeof value === 'string') this.cookies.set(name, value);
        }
      }
      this.log('info', `loaded ${this.cookies.size} stored cookie(s) from ${this.file}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') this.log('warn', `cookie jar not readable: ${error?.message ?? error}`);
    }
  }

  /** Absorb upstream `Set-Cookie` lines, dropping the ones that expired. */
  absorb(lines) {
    if (!Array.isArray(lines) || lines.length === 0) return;
    let changed = false;
    for (const line of lines) {
      const pair = String(line).split(';')[0] ?? '';
      const index = pair.indexOf('=');
      if (index < 1) continue;
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!name) continue;
      const attributes = String(line)
        .split(';')
        .slice(1)
        .map((attribute) => attribute.trim().toLowerCase());
      const expired =
        value === '' ||
        attributes.some((attribute) => attribute === 'max-age=0' || /^max-age=-\d+$/.test(attribute)) ||
        attributes.some((attribute) => attribute.startsWith('expires=thu, 01 jan 1970'));
      const previous = this.cookies.get(name);
      if (expired) {
        if (previous !== undefined) {
          this.cookies.delete(name);
          changed = true;
        }
        continue;
      }
      if (previous !== value) {
        this.cookies.set(name, value);
        changed = true;
      }
    }
    if (changed) this.scheduleSave();
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  size() {
    return this.cookies.size;
  }

  scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.save();
    }, JAR_SAVE_DEBOUNCE_MS);
    this.timer.unref?.();
  }

  async save() {
    try {
      await fsp.mkdir(path.dirname(this.file), { recursive: true });
      const payload = JSON.stringify({ savedAt: new Date().toISOString(), cookies: Object.fromEntries(this.cookies) }, null, 2);
      const temporary = `${this.file}.tmp`;
      await fsp.writeFile(temporary, payload, 'utf8');
      await fsp.rename(temporary, this.file);
    } catch (error) {
      this.log('warn', `cookie jar write failed: ${error?.message ?? error}`);
    }
  }

  saveSync() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const payload = JSON.stringify({ savedAt: new Date().toISOString(), cookies: Object.fromEntries(this.cookies) }, null, 2);
      fs.writeFileSync(this.file, payload, 'utf8');
    } catch (error) {
      this.log('warn', `cookie jar flush failed: ${error?.message ?? error}`);
    }
  }
}

/** Decode an upstream body according to its `content-encoding`. */
function decodeBody(buffer, encoding) {
  const value = String(encoding ?? '').trim().toLowerCase();
  if (!value || value === 'identity') return buffer;
  const first = value.split(',').map((part) => part.trim()).filter((part) => part && part !== 'identity')[0];
  if (!first) return buffer;
  if (first === 'gzip' || first === 'x-gzip') return zlib.gunzipSync(buffer);
  if (first === 'deflate') return zlib.inflateSync(buffer);
  if (first === 'br') return zlib.brotliDecompressSync(buffer);
  throw new Error(`unsupported content-encoding: ${first}`);
}

/** Join a browser `Cookie` header with the jar, letting the jar win on name clashes. */
function mergeCookies(browserHeader, jarHeader) {
  const merged = new Map();
  for (const segment of [browserHeader, jarHeader]) {
    for (const chunk of String(segment ?? '').split(';')) {
      const index = chunk.indexOf('=');
      if (index < 1) continue;
      merged.set(chunk.slice(0, index).trim(), chunk.slice(index + 1).trim());
    }
  }
  return [...merged].map(([name, value]) => `${name}=${value}`).join('; ');
}

/**
 * Keep only the `Set-Cookie` lines the page itself may read: `HttpOnly` ones stay in
 * the jar so the auth cookie never enters the browser, the rest are forwarded with
 * `Domain`/`Secure` removed so they apply to the loopback origin.
 */
function forwardableCookies(lines) {
  const forwarded = [];
  for (const line of lines ?? []) {
    const text = String(line);
    if (/\bhttponly\b/i.test(text)) continue;
    const attributes = text
      .split(';')
      .filter((attribute) => {
        const lowered = attribute.trim().toLowerCase();
        return lowered !== '' && lowered !== 'secure' && !lowered.startsWith('domain=');
      })
      .join(';');
    if (attributes.trim() !== '') forwarded.push(attributes);
  }
  return forwarded;
}

/**
 * Build the response headers to send to the browser from an upstream header bag.
 *
 * @param {http.IncomingHttpHeaders} source Upstream headers.
 * @param {{ origin: string, dropBodyFields?: boolean }} options
 * @returns {Record<string, string | string[]>}
 */
function responseHeaders(source, { origin, dropBodyFields = false }) {
  /** @type {Record<string, string | string[]>} */
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const lowered = key.toLowerCase();
    if (STRIP_HEADERS.has(lowered) || lowered === 'set-cookie') continue;
    if (dropBodyFields && (lowered === 'content-length' || lowered === 'content-encoding')) continue;
    if (lowered === 'location') {
      out[key] = String(value).replace(/^https?:\/\/(chat|chat-dev)\.deepseek\.com/i, origin);
      continue;
    }
    out[key] = value;
  }
  const forwarded = forwardableCookies(source['set-cookie']);
  if (forwarded.length > 0) out['set-cookie'] = forwarded;
  return out;
}

/** Normalise a request URL (origin-form or absolute-form) to a path with its query. */
function requestPath(rawUrl) {
  const value = String(rawUrl ?? '/');
  if (/^https?:\/\//i.test(value)) {
    try {
      const parsed = new URL(value);
      return `${parsed.pathname}${parsed.search}`;
    } catch {
      return '/';
    }
  }
  return value.startsWith('/') ? value : `/${value}`;
}

/** True for a host name that resolves to this machine's loopback interface. */
function isLoopbackHost(name) {
  const value = String(name ?? '').toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

/** Loopback pages (the Harness itself, dev scripts) may drive the control routes. */
function isLoopbackOrigin(header) {
  const text = String(header ?? '').trim();
  if (!text) return false;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    return isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Normalise whatever the user pasted into `{ token, id }`.
 *
 * Accepts the raw token, the app's stored envelope (`{"value":"…","__version":"0"}`),
 * and the object produced by the copy snippet (`{ token, id }`).
 *
 * @param {unknown} payload
 * @returns {{ token: string, id: string | null } | null}
 */
function normalizeSyncPayload(payload) {
  /** @type {unknown} */
  let source = payload;
  if (typeof source === 'string') {
    const text = source.trim();
    if (text.startsWith('{') || text.startsWith('"')) {
      try {
        source = JSON.parse(text);
      } catch {
        source = text;
      }
    }
  }
  let token = '';
  /** @type {string | null} */
  let id = null;
  if (typeof source === 'string') {
    token = source;
  } else if (source && typeof source === 'object') {
    const bag = /** @type {Record<string, any>} */ (source);
    const candidate = bag.token ?? bag.userToken ?? bag.access_token ?? bag.value;
    if (typeof candidate === 'string') token = candidate;
    else if (candidate && typeof candidate === 'object' && typeof candidate.value === 'string') token = candidate.value;
    const idCandidate = bag.id ?? bag.userId ?? bag.user_id;
    if (typeof idCandidate === 'number') id = String(idCandidate);
    else if (typeof idCandidate === 'string' && idCandidate.trim() !== '') id = idCandidate.trim();
  }
  token = String(token ?? '').trim();
  if (token.length > 1 && token.startsWith('"') && token.endsWith('"')) token = token.slice(1, -1).trim();
  if (!token || token.length > TOKEN_LIMIT || /[\r\n]/.test(token)) return null;
  return { token, id };
}

/** Parse a sync POST body: either JSON or one pasted line. */
function parseSyncBody(buffer, contentType) {
  const text = buffer.toString('utf8').trim();
  if (!text) return null;
  if (String(contentType ?? '').toLowerCase().includes('json')) {
    try {
      return normalizeSyncPayload(JSON.parse(text));
    } catch {
      return null;
    }
  }
  return normalizeSyncPayload(text);
}

/**
 * Seed the app's own persisted login handles before its bundle boots.
 *
 * The site keeps a session as a Bearer token in `localStorage` (`userToken` and
 * `__appKit_userInfo`, envelope `{ value, __version }`), written by its own login
 * flow — mirroring those two keys reuses the user's real session instead of
 * forging anything server-side.
 *
 * @param {string} html Upstream document with asset URLs already rewritten.
 * @param {{ token: string, id: string | null }} payload
 */
function injectSyncScript(html, payload) {
  const data = JSON.stringify({ token: payload.token, id: payload.id ?? null }).replace(/</g, '\\u003c');
  const script =
    '<script data-dsh-deepseek-sync="1">(function(){try{' +
    `var d=${data};` +
    'localStorage.setItem("userToken",JSON.stringify({value:d.token,__version:"0"}));' +
    'localStorage.setItem("__appKit_userInfo",JSON.stringify({value:{id:d.id},__version:"0"}));' +
    'document.documentElement.setAttribute("data-dsh-deepseek-sync","ok");' +
    '}catch(e){document.documentElement.setAttribute("data-dsh-deepseek-sync","error");}' +
    `try{fetch(${JSON.stringify(SYNC_ACK_PATH)},{method:"POST",keepalive:true});}catch(e){}` +
    '})();</script>';
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${script}${html.slice(at)}`;
  }
  return `${script}${html}`;
}

/**
 * Create the proxy. Nothing listens until {@link DeepSeekProxy.start} resolves.
 *
 * @param {{ host?: string, port?: number, stateDir?: string, log?: (level: string, message: string) => void }} options
 *   `host`/`port` choose the loopback listener (an unavailable port falls back to a free one),
 *   `stateDir` holds `cookies.json`, and `log` receives diagnostics.
 */
export function createDeepSeekProxy(options = {}) {
  const host = options.host ?? '127.0.0.1';
  const desiredPort = Number.isFinite(options.port) ? Number(options.port) : DEFAULT_PORT;
  const stateDir = options.stateDir ?? path.join(process.cwd(), '.deepseek-chat');
  const log = options.log ?? (() => {});
  const jar = new CookieJar(path.join(stateDir, 'cookies.json'), log);
  const agent = new https.Agent({ keepAlive: true, maxSockets: 64 });
  const syncFile = path.join(stateDir, 'pending-sync.json');
  /** A login token waiting to be seeded into the next document load. @type {{ token: string, id: string | null } | null} */
  let pendingSync = null;

  /** @type {http.Server | undefined} */
  let server;
  /** @type {string | null} */
  let baseUrl = null;
  let listeningPort = 0;
  const assetCache = new Map();

  function origin() {
    return baseUrl ? baseUrl.replace(/\/$/, '') : `http://${host}:${desiredPort}`;
  }

  /** A cross-site page must not drive the proxy, even from another local origin. */
  function originAllowed(req) {
    const header = req.headers.origin;
    if (!header) return true;
    const allowed = [origin(), UPSTREAM_ORIGIN];
    return allowed.some((candidate) => candidate.toLowerCase() === String(header).toLowerCase());
  }

  function sendJson(res, status, payload, extra = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      ...extra,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(body)),
    });
    res.end(body);
  }

  /** Read a login token queued by a previous Host run. */
  async function loadPendingSync() {
    try {
      const raw = JSON.parse(await fsp.readFile(syncFile, 'utf8'));
      pendingSync = normalizeSyncPayload(raw);
      if (pendingSync) log('info', 'a queued login token will be applied to the next page load');
    } catch (error) {
      if (error?.code !== 'ENOENT') log('warn', `queued login token not readable: ${error?.message ?? error}`);
    }
  }

  /** Queue a login token, persisting it so a Host restart does not drop it. */
  async function rememberPendingSync(payload) {
    pendingSync = payload;
    try {
      await fsp.mkdir(stateDir, { recursive: true });
      await fsp.writeFile(syncFile, JSON.stringify({ ...payload, savedAt: new Date().toISOString() }, null, 2), 'utf8');
    } catch (error) {
      log('warn', `queued login token write failed: ${error?.message ?? error}`);
    }
  }

  function clearPendingSync() {
    pendingSync = null;
    void fsp.rm(syncFile, { force: true }).catch(() => undefined);
  }

  /** The control routes are reachable from the Harness page on loopback only. */
  function corsHeaders(req) {
    const origin = req.headers.origin;
    return {
      'access-control-allow-origin': isLoopbackOrigin(origin) ? String(origin) : 'null',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '600',
      vary: 'origin',
    };
  }

  /** Control route: queue a login token, report it, or acknowledge that it was applied. */
  function handleSync(req, res, pathname) {
    const method = (req.method ?? 'GET').toUpperCase();
    const cors = corsHeaders(req);
    if (pathname === SYNC_ACK_PATH) {
      clearPendingSync();
      sendJson(res, 200, { ok: true, pending: false }, cors);
      return;
    }
    if (method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (method === 'GET') {
      sendJson(res, 200, { ok: true, pending: pendingSync !== null }, cors);
      return;
    }
    if (method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method not allowed' }, cors);
      return;
    }
    const chunks = [];
    let size = 0;
    let overflow = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > SYNC_BODY_LIMIT) {
        overflow = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', (error) => failRequest(res, error));
    req.on('end', () => {
      if (overflow) {
        sendJson(res, 413, { ok: false, error: 'body too large' }, cors);
        return;
      }
      const payload = parseSyncBody(Buffer.concat(chunks), req.headers['content-type']);
      if (!payload) {
        sendJson(res, 400, { ok: false, error: 'expected a chat.deepseek.com login token' }, cors);
        return;
      }
      void rememberPendingSync(payload).then(() => {
        log('info', `login token queued (${payload.token.length} chars, id ${payload.id ?? 'unknown'})`);
        sendJson(res, 200, { ok: true, pending: true }, cors);
      });
    });
  }

  function failRequest(res, error, status = 502) {
    if (res.headersSent) {
      try {
        res.destroy();
      } catch {}
      return;
    }
    const message = error?.message ?? String(error);
    log('warn', `proxy failure: ${message}`);
    sendJson(res, status, { ok: false, error: message });
  }

  function assetCacheGet(key) {
    const hit = assetCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.at > ASSET_CACHE_TTL_MS) {
      assetCache.delete(key);
      return null;
    }
    return hit;
  }

  function assetCacheSet(key, value) {
    if (assetCache.size >= ASSET_CACHE_ENTRIES) {
      const oldest = assetCache.keys().next().value;
      if (oldest !== undefined) assetCache.delete(oldest);
    }
    assetCache.set(key, value);
  }

  /** Serve one CDN asset, transforming the entry bundle and stylesheets. */
  function handleAsset(req, res, pathname) {
    const upstreamPath = `/chat${pathname.slice(LOCAL_PREFIX.length - 1)}`;
    const cached = assetCacheGet(upstreamPath);
    if (cached) {
      res.writeHead(cached.status, {
        ...cached.headers,
        'content-length': String(cached.body.length),
      });
      res.end(cached.body);
      return;
    }
    const request = https.request(
      {
        host: CDN_ORIGIN.replace('https://', ''),
        port: 443,
        servername: 'fe-static.deepseek.com',
        method: 'GET',
        path: upstreamPath,
        agent,
        headers: {
          host: 'fe-static.deepseek.com',
          accept: '*/*',
          'accept-encoding': 'identity',
          'user-agent': req.headers['user-agent'] ?? 'dsh-deepseek-chat',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', (error) => failRequest(res, error));
        response.on('end', () => {
          try {
            const status = response.statusCode ?? 200;
            const contentType = String(response.headers['content-type'] ?? '');
            const raw = Buffer.concat(chunks);
            let body = raw;
            let headers = responseHeaders(response.headers, { origin: origin(), dropBodyFields: false });
            const name = pathname.split('/').pop() ?? '';
            const isEntry = /^main\.[0-9a-z]+\.js$/i.test(name);
            const isCss = contentType.toLowerCase().includes('text/css') || name.endsWith('.css');
            if (status === 200 && (isEntry || isCss)) {
              const decoded = decodeBody(raw, response.headers['content-encoding']);
              const text = decoded.toString('utf8');
              if (isEntry) {
                const patched = patchEntryBundle(text);
                if (patched.missing.length > 0) {
                  log('warn', `entry bundle patterns missing: ${patched.missing.join(', ')}`);
                }
                body = Buffer.from(patched.text, 'utf8');
              } else {
                body = Buffer.from(rewriteCss(text).css, 'utf8');
              }
              headers = {
                ...headers,
                'content-type': isEntry ? 'application/javascript; charset=utf-8' : 'text/css; charset=utf-8',
              };
            }
            assetCacheSet(upstreamPath, { at: Date.now(), status, headers, body });
            res.writeHead(status, { ...headers, 'content-length': String(body.length) });
            res.end(body);
          } catch (error) {
            failRequest(res, error);
          }
        });
      },
    );
    request.on('error', (error) => failRequest(res, error));
    request.end();
  }

  /** Proxy everything that belongs to the upstream application itself. */
  function handleUpstream(req, res, pathname) {
    const method = req.method ?? 'GET';
    /** @type {Record<string, string | string[]>} */
    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (HOP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
      headers[key] = value;
    }
    headers.host = UPSTREAM_HOST;
    headers.origin = UPSTREAM_ORIGIN;
    headers.referer = `${UPSTREAM_ORIGIN}/`;
    headers.cookie = mergeCookies(req.headers.cookie, jar.header());
    headers['accept-encoding'] = 'gzip, deflate, br';
    if (DEBUG) {
      const auth = req.headers.authorization;
      log(
        'debug',
        `upstream ${method} ${pathname} auth=${auth ? String(auth).slice(0, 20) : 'none'} cookies=${jar.size()}`,
      );
    }

    const request = https.request(
      {
        host: UPSTREAM_HOST,
        port: 443,
        servername: UPSTREAM_HOST,
        method,
        path: pathname,
        headers,
        agent,
      },
      (response) => {
        jar.absorb(response.headers['set-cookie']);
        const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
        const status = response.statusCode ?? 200;
        if (contentType.startsWith('text/html')) {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', (error) => failRequest(res, error));
          response.on('end', () => {
            try {
              const decoded = decodeBody(Buffer.concat(chunks), response.headers['content-encoding']);
              const { html, replaced } = rewriteHtml(decoded.toString('utf8'), origin());
              if (replaced === 0) log('warn', 'document had no CDN asset URLs to rewrite');
              const queued = pendingSync;
              const body = Buffer.from(queued ? injectSyncScript(html, queued) : html, 'utf8');
              res.writeHead(status, {
                ...responseHeaders(response.headers, { origin: origin(), dropBodyFields: true }),
                'content-length': String(body.length),
                'cache-control': 'no-store',
              });
              res.end(body);
              if (queued && pendingSync === queued) {
                clearPendingSync();
                log('info', 'queued login token applied to the document');
              }
            } catch (error) {
              failRequest(res, error);
            }
          });
          return;
        }
        res.writeHead(status, responseHeaders(response.headers, { origin: origin() }));
        response.pipe(res);
        response.on('error', () => {
          try {
            res.destroy();
          } catch {}
        });
      },
    );
    request.on('error', (error) => failRequest(res, error));
    res.on('close', () => {
      if (!res.writableEnded) request.destroy();
    });
    if (method === 'GET' || method === 'HEAD') request.end();
    else req.pipe(request);
  }

  function handle(req, res) {
    try {
      const pathname = requestPath(req.url);
      const pathOnly = pathname.split('?')[0] ?? '/';
      const control = pathOnly === SYNC_PATH || pathOnly === SYNC_ACK_PATH;
      if (!originAllowed(req) && !(control && isLoopbackOrigin(req.headers.origin))) {
        sendJson(res, 403, { ok: false, error: 'cross-origin request rejected' });
        return;
      }
      if (control) {
        handleSync(req, res, pathOnly);
        return;
      }
      if (pathOnly === `${LOCAL_PREFIX}health`) {
        sendJson(res, 200, {
          ok: true,
          url: baseUrl,
          cookies: jar.size(),
          upstream: UPSTREAM_ORIGIN,
          pendingLogin: pendingSync !== null,
        });
        return;
      }
      if (pathOnly.startsWith(LOCAL_PREFIX)) {
        handleAsset(req, res, pathname);
        return;
      }
      handleUpstream(req, res, pathname);
    } catch (error) {
      failRequest(res, error);
    }
  }

  /** Tunnel a WebSocket upgrade (the app's TTS socket) to the upstream. */
  function handleUpgrade(req, socket, head) {
    try {
      const pathname = requestPath(req.url);
      if (!pathname.startsWith('/api/')) {
        socket.end('HTTP/1.1 404 Not Found\r\n\r\n');
        return;
      }
      socket.setNoDelay(true);
      const connection = tls.connect({ host: UPSTREAM_HOST, port: 443, servername: UPSTREAM_HOST }, () => {
        const lines = [`GET ${pathname} HTTP/1.1`];
        /** @type {Record<string, string | string[]>} */
        const headers = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (value === undefined) continue;
          if (key === 'host' || key === 'cookie' || key === 'origin') continue;
          headers[key] = value;
        }
        headers.host = UPSTREAM_HOST;
        headers.origin = UPSTREAM_ORIGIN;
        headers.cookie = mergeCookies(req.headers.cookie, jar.header());
        for (const [key, value] of Object.entries(headers)) {
          lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : value}`);
        }
        connection.write(`${lines.join('\r\n')}\r\n\r\n`);
        if (head && head.length > 0) connection.write(head);
        connection.pipe(socket);
        socket.pipe(connection);
        socket.resume();
      });
      connection.on('error', (error) => {
        log('warn', `websocket upstream error: ${error?.message ?? error}`);
        connection.destroy();
        socket.destroy();
      });
      socket.on('error', () => connection.destroy());
      socket.on('close', () => connection.destroy());
    } catch (error) {
      log('warn', `websocket setup failed: ${error?.message ?? error}`);
      try {
        socket.destroy();
      } catch {}
    }
  }

  function listen(port) {
    return new Promise((resolve, reject) => {
      const candidate = http.createServer((req, res) => handle(req, res));
      candidate.on('upgrade', (req, socket, head) => handleUpgrade(req, socket, head));
      candidate.on('clientError', (_error, socket) => {
        try {
          socket.destroy();
        } catch {}
      });
      const onError = (error) => {
        candidate.removeListener('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        candidate.removeListener('error', onError);
        listeningPort = /** @type {import('node:net').AddressInfo} */ (candidate.address()).port;
        baseUrl = `http://${host}:${listeningPort}/`;
        resolve(candidate);
      };
      candidate.once('error', onError);
      candidate.once('listening', onListening);
      candidate.listen(port, host);
    });
  }

  const api = {
    /** @returns {string | null} Proxy origin with a trailing slash, once started. */
    get url() {
      return baseUrl;
    },
    get running() {
      return server !== undefined && server !== null;
    },
    get port() {
      return listeningPort;
    },
    get cookieCount() {
      return jar.size();
    },
    /** Whether a pasted login token is waiting for the next page load. */
    get pendingLogin() {
      return pendingSync !== null;
    },
    /**
     * Queue a pasted login payload for the next document load.
     *
     * The Harness-served route uses this instead of `POST /__ds/sync`: it is
     * same-origin for the page (so no CORS or preflight can fail) and it keeps
     * working when the loopback port had to fall back to a free one.
     *
     * @param {unknown} payload Raw token, the app's storage envelope, or `{ token, id }`.
     * @returns {{ ok: true } | { ok: false, error: string }}
     */
    queueLogin(payload) {
      const normalized = normalizeSyncPayload(payload);
      if (!normalized) return { ok: false, error: 'expected a chat.deepseek.com login token' };
      pendingSync = normalized;
      void rememberPendingSync(normalized).then(() => {
        log('info', `login token queued via the Harness route (${normalized.token.length} chars, id ${normalized.id ?? 'unknown'})`);
      });
      return { ok: true };
    },
    async start() {
      if (server) return api;
      await Promise.all([jar.load(), loadPendingSync()]);
      try {
        server = await listen(desiredPort);
      } catch (error) {
        log('warn', `port ${desiredPort} unavailable (${error?.code ?? error?.message}); using a free port`);
        server = await listen(0);
      }
      log('info', `deepseek chat proxy listening on ${baseUrl}`);
      return api;
    },
    async close() {
      jar.saveSync();
      agent.destroy();
      const current = server;
      server = undefined;
      baseUrl = null;
      if (!current) return;
      await new Promise((resolve) => current.close(() => resolve(undefined)));
    },
  };
  return api;
}
