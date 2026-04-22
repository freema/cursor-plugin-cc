#!/usr/bin/env node
import { collapseArguments, parseArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { mostRecentFinishedJob, readJob } from './lib/jobs.mjs';

function render(job) {
  const lines = [];
  lines.push(`### Result of job \`${job.id}\` — ${job.status}`);
  lines.push('');
  lines.push(`**Model:** ${job.model}`);
  if (job.finishedAt) lines.push(`**Finished:** ${job.finishedAt}`);
  if (typeof job.exitCode === 'number') lines.push(`**Exit code:** ${job.exitCode}`);
  lines.push('');
  lines.push(`**Prompt:** ${job.prompt}`);
  if (job.filesTouched && job.filesTouched.length > 0) {
    lines.push('');
    lines.push('**Files touched:**');
    for (const f of job.filesTouched) lines.push(`- ${f}`);
  }
  lines.push('');
  lines.push('**Summary:**');
  lines.push('');
  lines.push((job.summary ?? '(no summary captured)').trim());
  lines.push('');
  if (job.cursorChatId) {
    lines.push(`Resume: \`cursor-agent --resume=${job.cursorChatId}\``);
  } else {
    lines.push('Cursor chat id was not captured for this job.');
  }
  return lines.join('\n') + '\n';
}

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
  const id = positional[0];
  const job = id ? readJob(root, id) : mostRecentFinishedJob(root);
  if (!job) {
    process.stderr.write(
      id
        ? `No job \`${id}\` found for this repository.\n`
        : 'No finished Cursor jobs tracked for this repository yet.\n',
    );
    return 1;
  }
  if (job.status === 'running') {
    process.stdout.write(
      `Job \`${job.id}\` is still running. Use \`/cursor:status ${job.id}\` to monitor it.\n`,
    );
    return 0;
  }
  process.stdout.write(render(job));
  return 0;
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`result failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
