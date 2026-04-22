#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { main as delegateMain } from './delegate.js';

export async function main(rawArgv: string[]): Promise<number> {
  const argv = rawArgv.slice();
  const hasResume = argv.some((a) => a === '--resume' || a.startsWith('--resume='));
  if (!hasResume) argv.unshift('--resume');
  return delegateMain(argv);
}

const invokedAsScript = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`resume failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
