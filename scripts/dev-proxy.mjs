/**
 * Run the proxy on its own, without Harness, to check that it serves the upstream
 * document and patches the entry bundle. The plugin itself starts the same proxy
 * from `index.js`.
 *
 *   node scripts/dev-proxy.mjs [port]
 *
 * State (the cookie jar) is written under `.cache/state` inside the package.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeepSeekProxy } from '../src/proxy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.argv[2] ?? '3097', 10);
const stateDir = process.env.DSH_DEEPSEEK_CHAT_STATE ?? path.join(here, '..', '.cache', 'state');

const proxy = createDeepSeekProxy({
  port,
  stateDir,
  log: (level, message) => console.log(`[${level}] ${message}`),
});

await proxy.start();
console.log(`probe-url ${proxy.url}`);

const shutdown = async () => {
  await proxy.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
