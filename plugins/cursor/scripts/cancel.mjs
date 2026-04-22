#!/usr/bin/env node
import { collapseArguments, parseArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { cancelJob, findRunningJobs } from './lib/jobs.mjs';

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const delimiterIdx = rawArgv.indexOf('--');
  const firstHalf = delimiterIdx === -1 ? [] : rawArgv.slice(0, delimiterIdx);
  const userRaw =
    delimiterIdx === -1 ? rawArgv.join(' ') : rawArgv.slice(delimiterIdx + 1).join(' ');
  const combined = [...firstHalf, ...collapseArguments(userRaw)];
  const { positional } = parseArgv(combined);
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
  const updated = await cancelJob(root, id);
  if (!updated) {
    process.stderr.write(`No job \`${id}\` found for this repository.\n`);
    return 1;
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
