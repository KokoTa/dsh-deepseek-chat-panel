/**
 * 在同一个进程加载 node:test 测试，兼容 Node 20，也能在禁止子进程管道的环境中运行。
 * node:test 仍负责计数、输出和失败退出码；这里仅负责发现测试文件。
 */
import { readdir } from 'node:fs/promises';

const testDirectory = new URL('../test/', import.meta.url);
const files = (await readdir(testDirectory)).filter((name) => name.endsWith('.test.mjs')).sort();
for (const file of files) await import(new URL(file, testDirectory));
