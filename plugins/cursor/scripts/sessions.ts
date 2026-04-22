#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { listSessions } from './lib/cursor.js';
import { repoRoot } from './lib/git.js';
import { listJobs } from './lib/jobs.js';

export async function main(): Promise<number> {
  const root = await repoRoot(process.cwd());
  const sessions = await listSessions(root);
  if (sessions.length > 0) {
    process.stdout.write('### Cursor sessions for this repository\n\n');
    process.stdout.write('| Chat ID | Updated | Summary |\n| --- | --- | --- |\n');
    for (const s of sessions) {
      const updated = s.updatedAt ?? '—';
      const summary = (s.summary ?? '').replace(/\s+/g, ' ').slice(0, 80);
      process.stdout.write(`| \`${s.id}\` | ${updated} | ${summary} |\n`);
    }
    process.stdout.write('\nResume any of them with `cursor-agent --resume=<id>`.\n');
    return 0;
  }

  process.stdout.write(
    '`cursor-agent ls` returned no sessions (or timed out). Falling back to local job registry:\n\n',
  );
  const jobs = listJobs(root, { limit: 10 });
  if (jobs.length === 0) {
    process.stdout.write('No local jobs tracked for this repository yet.\n');
    return 0;
  }
  process.stdout.write(
    '| Job ID | Status | Cursor chat id | Prompt |\n| --- | --- | --- | --- |\n',
  );
  for (const j of jobs) {
    const chat = j.cursorChatId ? `\`${j.cursorChatId}\`` : '—';
    const prompt = j.prompt.replace(/\s+/g, ' ').slice(0, 60);
    process.stdout.write(`| \`${j.id}\` | ${j.status} | ${chat} | ${prompt} |\n`);
  }
  return 0;
}

const invokedAsScript = (() => {
  try {
    return process.argv[1] === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(
        `sessions failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    });
}
