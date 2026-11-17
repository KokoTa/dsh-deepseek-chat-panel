/** 检查全部维护源码和生成入口，不依赖手工维护文件列表。 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildClient } from './build-client.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

/**
 * 递归收集 JavaScript 文件，只遍历明确指定的源码目录。
 * @param {string} directory 完整目录路径。
 * @returns {Promise<string[]>} JavaScript 文件完整路径数组。
 */
async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const groups = await Promise.all(entries.map((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:js|mjs)$/.test(entry.name) ? [file] : [];
  }));
  return groups.flat();
}

/**
 * 检查语法，再确认已提交的浏览器产物与模块源码一致。
 * @returns {Promise<void>} 全部通过时结束；任一项失败时抛错。
 */
async function main() {
  const files = [path.join(root, 'index.js'), path.join(root, 'client.js'),
    ...(await Promise.all(['src', 'scripts', 'test'].map((dir) => sourceFiles(path.join(root, dir))))).flat()];
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`语法检查失败：${path.relative(root, file)}`);
  }
  await buildClient({ check: true });
  console.log(`已检查 ${files.length} 个 JavaScript 文件，浏览器产物与源码一致。`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
