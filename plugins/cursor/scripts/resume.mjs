#!/usr/bin/env node
import { main as delegateMain } from './delegate.mjs';

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const argv = rawArgv.slice();
  const hasResume = argv.some((a) => a === '--resume' || a.startsWith('--resume='));
  if (!hasResume) argv.unshift('--resume');
  return delegateMain(argv);
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`resume failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
