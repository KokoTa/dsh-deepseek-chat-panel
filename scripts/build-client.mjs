import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const outputPath = path.join(projectRoot, 'client.js');
const cliPath = createRequire(import.meta.url).resolve('esbuild/bin/esbuild');

/**
 * 调用本地安装的 esbuild CLI，输出直接交给终端，避免创建捕获日志的子进程管道。
 * Windows 的 CLI 是 Node 启动脚本，其他平台使用 esbuild 安装的可执行文件。
 *
 * @param {string} temporaryOutput 临时产物的绝对路径。
 * @returns {Promise<void>} CLI 退出码为 0 时完成，启动或构建失败时拒绝。
 */
function runEsbuild(temporaryOutput) {
  const flags = [
    'src/client/index.js',
    '--bundle',
    '--format=iife',
    '--platform=browser',
    '--target=es2020',
    '--charset=utf8',
    '--legal-comments=inline',
    '--log-level=error',
    '--banner:js=// 此文件由 scripts/build-client.mjs 自动生成，请修改 src/client/ 下的源码后重新构建。',
    `--outfile=${temporaryOutput}`,
  ];
  const command = process.platform === 'win32' ? process.execPath : cliPath;
  const args = process.platform === 'win32' ? [cliPath, ...flags] : flags;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: projectRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`esbuild 构建失败：${signal ?? `退出码 ${code}`}。`));
    });
  });
}

/**
 * 将页面 ESM 源码合成浏览器脚本，入口仍使用 window.__ModuleLoader__.load。
 * 先写入临时目录再比对；检查模式不会更新根 client.js，临时目录始终会清理。
 *
 * @param {{check?: boolean}} [options] check 为 true 时要求根 client.js 与源码一致。
 * @returns {Promise<{outputPath: string, changed: boolean}>} 产物绝对路径，以及构建前内容是否不同。
 * @throws {Error} 构建失败，或检查模式发现产物缺失、过期时抛出。
 */
export async function buildClient({ check = false } = {}) {
  const temporaryDirectory = await mkdtemp(path.join(projectRoot, '.client-build-'));
  try {
    const temporaryOutput = path.join(temporaryDirectory, 'client.js');
    await runEsbuild(temporaryOutput);
    const contents = await readFile(temporaryOutput, 'utf8');
    const previous = await readFile(outputPath, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    const changed = previous !== contents;
    if (check && changed) {
      throw new Error('根 client.js 与页面源码不一致，请运行 npm run build 后再检查。');
    }
    if (!check && changed) await writeFile(outputPath, contents, 'utf8');
    return { outputPath, changed };
  } finally {
    // 只删除刚创建的构建目录，先确认它确实位于当前项目下且名称符合约定。
    const resolvedDirectory = path.resolve(temporaryDirectory);
    if (path.dirname(resolvedDirectory) !== projectRoot || !path.basename(resolvedDirectory).startsWith('.client-build-')) {
      throw new Error('临时构建目录路径异常，已停止清理。');
    }
    await rm(resolvedDirectory, { recursive: true, force: true });
  }
}

/**
 * 执行命令行构建或检查，参数错误和构建错误都会保留非零退出码。
 *
 * @param {string[]} args node 脚本路径之后的参数，只接受 --check。
 * @returns {Promise<void>} 完成后打印对应结果，失败时交给入口设置退出码。
 */
async function main(args) {
  if (args.some((argument) => argument !== '--check')) {
    throw new Error('用法：node scripts/build-client.mjs [--check]');
  }
  const check = args.includes('--check');
  const { changed } = await buildClient({ check });
  console.log(check ? 'client.js 已与页面源码一致。' : `client.js ${changed ? '已构建。' : '已是最新。'}`);
}

// 被 check 脚本 import 时只提供 buildClient，不自动执行命令行逻辑。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
