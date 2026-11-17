/**
 * 不启动 Harness，单独运行同一套回环代理，方便检查网页、资源改写和登录态同步。
 * 用法：npm run dev -- [端口]。不传端口时读环境变量，再默认用 3097；传 0 时自动找空闲端口。
 * 开发状态默认存到本项目的 .cache/state，也可以用 DSH_DEEPSEEK_CHAT_STATE 指定目录。
 * 脚本只读进程环境变量，不会自动加载 .env 文件。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readProxyConfig } from '../src/config.js';
import { createDeepSeekProxy } from '../src/proxy.js';

const scriptPath = fileURLToPath(import.meta.url);
const devStateDir = path.resolve(path.dirname(scriptPath), '..', '.cache', 'state');

/**
 * 把命令行端口转成数字，拒绝小数、负数、混合文本和超出范围的值。
 * 输入：命令行里的端口文本；输出：0..65535 的整数，0 表示让系统分配端口。
 *
 * @param {string} value 用户传入的端口。
 * @returns {number} 已检查的端口。
 * @throws {RangeError} 端口不是范围内的十进制整数时抛错。
 */
function readCliPort(value) {
  const text = value.trim();
  const port = Number(text);
  if (!/^\d+$/.test(text) || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new RangeError('开发代理端口必须是 0..65535 的十进制整数，0 表示自动分配端口。');
  }
  return port;
}

/**
 * 在共享代理配置上加开发默认值，最后用命令行端口覆盖环境变量。
 * 输入：去掉 node 和脚本路径后的参数、环境变量；输出：可直接交给代理的完整配置。
 *
 * @param {string[]} [argv=process.argv.slice(2)] 最多一个端口参数。
 * @param {NodeJS.ProcessEnv} [env=process.env] 当前进程的环境变量。
 * @returns {{ host: string, port: number, stateDir: string, debug: boolean }} 开发代理配置。
 * @throws {TypeError} 传了多余的命令行参数时抛错。
 * @throws {RangeError} 命令行端口不合法时抛错。
 */
export function readDevProxyConfig(argv = process.argv.slice(2), env = process.env) {
  if (argv.length > 1) throw new TypeError('用法：npm run dev -- [端口]，只能传一个端口。');
  const config = readProxyConfig(env);
  return {
    ...config,
    stateDir: env.DSH_DEEPSEEK_CHAT_STATE?.trim() ? config.stateDir : devStateDir,
    port: argv[0] === undefined ? config.port : readCliPort(argv[0]),
  };
}

/**
 * 把代理日志写到终端，方便手动检查启动和转发情况。
 * 输入：日志级别、日志内容；输出：无，只打印一行文字。
 *
 * @param {string} level 日志级别。
 * @param {string} message 日志内容。
 * @returns {void}
 */
function logProxyMessage(level, message) {
  console.log(`[${level}] ${message}`);
}

/**
 * 启动开发代理，并在收到退出信号后关掉代理。
 * 输入：无，配置来自命令行和环境变量；输出：代理启动完成的 Promise。
 *
 * @returns {Promise<void>} 启动完成后结束，HTTP 服务继续运行。
 */
async function runDevProxy() {
  const proxy = createDeepSeekProxy({ ...readDevProxyConfig(), log: logProxyMessage });
  await proxy.start();
  console.log(`probe-url ${proxy.url}`);

  let closing = false;
  /**
   * 保存状态并关闭服务，重复收到信号时只执行一次。
   * 输入：无；输出：关闭完成的 Promise，随后结束进程。
   *
   * @returns {Promise<void>} 关闭完成后结束。
   */
  async function shutdown() {
    if (closing) return;
    closing = true;
    await proxy.close();
    process.exit(0);
  }

  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

// 直接运行脚本才启动服务；导入配置函数做检查时不会占端口或写状态文件。
if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    await runDevProxy();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
