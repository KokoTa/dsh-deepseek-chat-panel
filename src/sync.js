/**
 * 登录态同步工具。
 *
 * 面板允许用户从正式站点复制一次性登录凭据。这里仅负责解析、校验和把凭据
 * 注入上游 HTML，不负责保存文件或处理 HTTP 请求。
 */

import { SYNC_ACK_PATH, TOKEN_LIMIT } from './config.js';

/**
 * 把用户输入统一成 `{ token, id }`。
 * 输入可以是裸 token、站点 localStorage 的 envelope 或 `{ token, id }` 对象。
 * 输出是规范对象；输入不可信或不符合限制时返回 null。
 *
 * @param {unknown} payload 用户粘贴的原始内容。
 * @returns {{ token: string, id: string | null } | null} 规范化后的登录态。
 */
export function normalizeSyncPayload(payload) {
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

/**
 * 解析登录态同步 POST 请求体。
 * 输入：请求体字节和 Content-Type；输出：规范化登录态或 null。
 *
 * @param {Buffer} buffer 请求体。
 * @param {string | string[] | undefined} contentType Content-Type 请求头。
 * @returns {{ token: string, id: string | null } | null} 解析结果。
 */
export function parseSyncBody(buffer, contentType) {
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
 * 在 HTML 的 head 开头注入一次性登录态脚本。
 * 输入：已经改写资源地址的 HTML 和登录态；输出：带注入脚本的 HTML。
 *
 * @param {string} html 上游 HTML。
 * @param {{ token: string, id: string | null, syncId?: string }} payload 规范化登录态。
 * @returns {string} 注入脚本后的 HTML。
 */
export function injectSyncScript(html, payload) {
  const data = JSON.stringify({ token: payload.token, id: payload.id ?? null, syncId: payload.syncId }).replace(/</g, '\\u003c');
  const script =
    '<script data-dsh-deepseek-sync="1">(function(){try{' +
    `var d=${data};` +
    'localStorage.setItem("userToken",JSON.stringify({value:d.token,__version:"0"}));' +
    'localStorage.setItem("__appKit_userInfo",JSON.stringify({value:{id:d.id},__version:"0"}));' +
    'document.documentElement.setAttribute("data-dsh-deepseek-sync","ok");' +
    `if(d.syncId)fetch(${JSON.stringify(SYNC_ACK_PATH)},{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({syncId:d.syncId}),keepalive:true}).catch(function(){});` +
    '}catch(e){document.documentElement.setAttribute("data-dsh-deepseek-sync","error");}' +
    '})();</script>';
  const head = html.match(/<head[^>]*>/i);
  if (head && head.index !== undefined) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}${script}${html.slice(at)}`;
  }
  return `${script}${html}`;
}
