/**
 * Text transforms applied to the DeepSeek web app while it is served through the
 * Host-side loopback proxy.
 *
 * The upstream document is a tiny shell that pulls its bundles from
 * `https://fe-static.deepseek.com/chat/` and refuses to be framed
 * (`content-security-policy: frame-ancestors 'none'`). Two facts make a thin
 * proxy possible:
 *
 *  - the rspack public path is a single literal, `h.p="https://fe-static.deepseek.com/chat/"`,
 *    so every lazily loaded chunk follows it;
 *  - the app reads `location.hostname` once to pick an environment, and an IPv4
 *    origin (the loopback proxy) selects "dev" while any other unknown host
 *    throws. Forcing "production" keeps the real API host, ids and telemetry.
 *
 * The transforms are string-based on purpose: they must survive minor bundle
 * updates, and every transform reports whether it matched so a stale pattern can
 * be logged instead of silently producing a broken page.
 */

/** Absolute CDN prefix the upstream HTML and CSS use for their assets. */
export const CDN_PREFIX = 'https://fe-static.deepseek.com/chat/';

/** Path prefix the proxy owns on its own origin. */
export const LOCAL_PREFIX = '/__ds/';

/**
 * Rewrite the upstream HTML document for the proxy origin.
 *
 * - `integrity`/`crossorigin` are dropped because the proxy no longer serves the
 *   exact bytes the SRI hashes describe (and the app strips SRI at boot anyway).
 * - Every CDN asset URL is routed through {@link LOCAL_PREFIX} so the document,
 *   its stylesheet, fonts and the patched entry bundle share one origin.
 *
 * @param {string} html Upstream document text.
 * @param {string} origin Proxy origin without a trailing slash, e.g. `http://127.0.0.1:3097`.
 * @returns {{ html: string, replaced: number }}
 */
export function rewriteHtml(html, origin) {
  let out = html.replace(/\s+integrity="[^"]*"/g, '');
  out = out.replace(/\s+crossorigin(?=[\s>/])/g, '');
  const parts = out.split(CDN_PREFIX);
  out = parts.join(`${origin}${LOCAL_PREFIX}`);
  return { html: out, replaced: parts.length - 1 };
}

/**
 * Rewrite a stylesheet so `url(...)` targets resolve through the proxy origin
 * (fonts and images would otherwise be fetched cross-origin, where the CDN's
 * `access-control-allow-origin: https://*.deepseek.com` is not a usable grant).
 *
 * @param {string} css Upstream stylesheet text.
 * @returns {{ css: string, replaced: number }}
 */
export function rewriteCss(css) {
  const parts = css.split(CDN_PREFIX);
  return { css: parts.join(LOCAL_PREFIX), replaced: parts.length - 1 };
}

/** Patterns patched into the entry bundle, most specific first. */
const ENTRY_PATCHES = [
  {
    id: 'environment',
    from: 'let e=location.hostname;if(e.match(/(\\d{1,3}\\.){3,3}\\d{1,3}/))return"dev";',
    to: 'let e="chat.deepseek.com";if(!1)return"dev";',
  },
  {
    id: 'hostname-fallback',
    from: 'throw Error("Unknown hostname: ".concat(e))',
    to: 'return"production"',
  },
  {
    id: 'tts-websocket-scheme',
    from: 'wsEndpoint:"wss://".concat(window.location.host,"/api/v0/chat/tts/")',
    to: 'wsEndpoint:(window.location.protocol==="https:"?"wss://":"ws://").concat(window.location.host,"/api/v0/chat/tts/")',
  },
  {
    id: 'public-path',
    from: 'h.p="https://fe-static.deepseek.com/chat/"',
    to: 'h.p=(window.location.origin+"/__ds/")',
  },
];

/**
 * Patch the entry bundle so the app boots as production code on the proxy origin
 * and loads its lazy chunks from that same origin.
 *
 * @param {string} source Upstream entry bundle text.
 * @returns {{ text: string, applied: string[], missing: string[] }} Patched source plus
 *   which patterns matched, so a bundle update that renamed a pattern is visible in logs.
 */
export function patchEntryBundle(source) {
  let text = source;
  const applied = [];
  const missing = [];
  for (const patch of ENTRY_PATCHES) {
    if (!text.includes(patch.from)) {
      missing.push(patch.id);
      continue;
    }
    text = text.replace(patch.from, patch.to);
    applied.push(patch.id);
  }
  return { text, applied, missing };
}
