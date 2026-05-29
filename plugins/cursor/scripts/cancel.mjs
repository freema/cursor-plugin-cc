#!/usr/bin/env node
import { parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { cancelJob, findRunningJobs, readJob } from './lib/jobs.mjs';

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional } = parseCommandArgv(rawArgv);
  const root = await repoRoot(process.cwd());
  let id = positional[0];
  if (!id) {
    const running = findRunningJobs(root);
    if (running.length === 0) {
      process.stdout.write('No running Cursor jobs to cancel.\n');
      return 0;
    }
    if (running.length > 1) {
      process.stderr.write(
        `Multiple running jobs (${running.length}). Pass an explicit id, e.g. \`/cursor:cancel ${running[0]?.id}\`.\n`,
      );
      return 2;
    }
    id = running[0]?.id;
  }
  if (!id) {
    process.stderr.write('No job id resolved.\n');
    return 2;
  }
  const before = readJob(root, id);
  const updated = await cancelJob(root, id);
  if (!updated) {
    process.stderr.write(`No job \`${id}\` found for this repository.\n`);
    return 1;
  }
  if (before && before.status !== 'running') {
    process.stdout.write(
      `Job \`${updated.id}\` was not running (already ${updated.status}); nothing to cancel.\n`,
    );
    return 0;
  }
  process.stdout.write(`Job \`${updated.id}\` marked as ${updated.status}.\n`);
  return 0;
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`cancel failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
