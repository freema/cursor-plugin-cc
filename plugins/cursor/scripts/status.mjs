#!/usr/bin/env node
import { parseCommandArgv } from './lib/args.mjs';
import { repoRoot } from './lib/git.mjs';
import { jobNotFoundMessage } from './lib/hints.mjs';
import { listJobs, readJob } from './lib/jobs.mjs';
import { mdCell } from './lib/md.mjs';

function age(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '?';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function truncate(s, n) {
  const clean = mdCell(s);
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean;
}

function renderTable(rows) {
  if (rows.length === 0) return 'No Cursor jobs tracked for this repository yet.\n';
  const header = '| ID | Status | Model | Age | Prompt |';
  const sep = '| --- | --- | --- | --- | --- |';
  const body = rows
    .map(
      (r) =>
        `| \`${r.id}\` | ${mdCell(r.status)} | ${mdCell(r.model)} | ${age(r.startedAt)} | ${truncate(
          r.prompt,
          60,
        )} |`,
    )
    .join('\n');
  return `${header}\n${sep}\n${body}\n`;
}

function renderDetail(r) {
  const lines = [];
  lines.push(`### Job \`${r.id}\``);
  lines.push('');
  lines.push(`- **Status:** ${r.status}`);
  lines.push(`- **Model:** ${r.model}`);
  lines.push(`- **Started:** ${r.startedAt}`);
  if (r.finishedAt) lines.push(`- **Finished:** ${r.finishedAt}`);
  if (typeof r.exitCode === 'number') lines.push(`- **Exit code:** ${r.exitCode}`);
  if (r.pid) lines.push(`- **PID:** ${r.pid}`);
  if (r.cursorChatId) {
    lines.push(`- **Cursor chat id:** \`${r.cursorChatId}\``);
    lines.push(`  Resume: \`cursor-agent --resume=${r.cursorChatId}\``);
  }
  if (r.cloud) lines.push('- **Cloud:** yes');
  if (r.background) lines.push('- **Background:** yes');
  lines.push('');
  lines.push(`**Prompt:** ${r.prompt}`);
  if (r.filesTouched && r.filesTouched.length > 0) {
    lines.push('');
    lines.push('**Files touched:**');
    for (const f of r.filesTouched) lines.push(`- ${f}`);
  }
  if (r.summary) {
    lines.push('');
    lines.push('**Summary:**');
    lines.push('');
    lines.push(r.summary.trim());
  }
  lines.push('');
  lines.push(`**Raw log:** \`${r.rawLogPath}\``);
  return lines.join('\n') + '\n';
}

/**
 * @param {string[]} rawArgv
 * @returns {Promise<number>}
 */
export async function main(rawArgv) {
  const { positional, flags } = parseCommandArgv(rawArgv, ['all']);
  const root = await repoRoot(process.cwd());
  const id = positional[0];
  if (id) {
    const job = readJob(root, id);
    if (!job) {
      process.stderr.write(jobNotFoundMessage(id));
      return 1;
    }
    process.stdout.write(renderDetail(job));
    return 0;
  }
  const limit = flags['all'] ? undefined : 10;
  const listOpts = {};
  if (typeof limit === 'number') listOpts.limit = limit;
  const rows = listJobs(root, listOpts);
  process.stdout.write(renderTable(rows));
  return 0;
}

import { invokedAsScript as __isScript } from './lib/invoked.mjs';
const invokedAsScript = __isScript(import.meta.url);

if (invokedAsScript) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`status failed: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    });
}
