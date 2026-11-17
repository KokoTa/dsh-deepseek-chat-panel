/** 登录态待办队列：只保存尚未注入页面的一份凭据，不提供读取 token 的 HTTP 接口。 */
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { normalizeSyncPayload } from './sync.js';

export class LoginStore {
  /**
   * 创建队列，文件操作排成一队，避免旧写入覆盖新凭据或在清理后重新出现。
   * @param {string} file 待同步文件的完整路径。
   * @param {(level: string, message: string) => void} log 不包含凭据的日志函数。
   */
  constructor(file, log) {
    this.file = file;
    this.log = log;
    this.pending = null;
    this.writes = Promise.resolve();
  }

  /**
   * 恢复上次未处理的登录态；启动期间已有新输入时优先保留新输入。
   * @returns {Promise<void>} 读取结束；缺文件正常忽略，其他错误只记日志。
   */
  async load() {
    try {
      const stored = JSON.parse(await fs.readFile(this.file, 'utf8'));
      const value = normalizeSyncPayload(stored);
      if (!this.pending && value) this.pending = {
        ...value, syncId: typeof stored.syncId === 'string' ? stored.syncId : randomUUID(),
      };
    } catch (error) {
      if (error.code !== 'ENOENT') this.log('warn', `待同步登录态读取失败：${error.message}`);
    }
  }

  /**
   * 串行执行一次文件操作，失败不会阻断后面的写入。
   * @param {() => Promise<unknown>} operation 要执行的文件操作。
   * @returns {Promise<void>} 本次操作结束后的 Promise。
   */
  enqueue(operation) {
    this.writes = this.writes.then(operation).then(() => undefined).catch((error) => {
      this.log('warn', `待同步登录态保存失败：${error.message}`);
    });
    return this.writes;
  }

  /**
   * 校验并排队凭据，立即更新内存，文件按顺序写入。
   * @param {unknown} payload 裸 token、JSON 文本或含 token 的对象。
   * @returns {{ok: true} | {ok: false, error: string}} 入队结果，不返回凭据。
   */
  queue(payload) {
    const normalized = normalizeSyncPayload(payload);
    if (!normalized) return { ok: false, error: 'expected a chat.deepseek.com login token' };
    const value = { ...normalized, syncId: randomUUID() };
    this.pending = value;
    void this.enqueue(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify({ ...value, savedAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    });
    return { ok: true };
  }

  /**
   * 只清理指定那份凭据，避免旧文档的响应把新排队的凭据删掉。
   * @param {{token: string, id: string | null, syncId: string} | null} expected 当时取出的凭据对象。
   * @returns {void} 内存立即清理，文件删除排在已有写入后面。
   */
  clear(expected) {
    if (!expected || this.pending !== expected) return;
    this.pending = null;
    void this.enqueue(() => fs.rm(this.file, { force: true }));
  }

  /** @returns {Promise<void>} 等待已排队的文件操作结束，供关闭代理时调用。 */
  flush() {
    return this.writes;
  }
}
