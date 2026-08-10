#!/usr/bin/env node
// Test stub for `cursor-agent`. Emits a fixture NDJSON stream chosen by
// the CURSOR_AGENT_STUB_FIXTURE env var, then exits.
import { readFileSync, writeFileSync } from 'node:fs';

// `cursor-agent status` — auth check used by authStatus(). Controlled by
// CURSOR_AGENT_STUB_AUTH: 'out' simulates a logged-out CLI.
if (process.argv[2] === 'status') {
  if (process.env.CURSOR_AGENT_STUB_AUTH === 'out') {
    process.stdout.write('Not logged in\n');
    process.exit(1);
  }
  process.stdout.write('Logged in as test-stub\n');
  process.exit(0);
}

// Like the real cursor-agent in print mode, the prompt arrives on stdin.
// CURSOR_AGENT_STUB_PROMPT_OUT lets tests assert what was received.
let prompt = '';
try {
  prompt = readFileSync(0, 'utf8');
} catch {
  /* stdin ignored or closed */
}
if (process.env.CURSOR_AGENT_STUB_PROMPT_OUT) {
  writeFileSync(process.env.CURSOR_AGENT_STUB_PROMPT_OUT, prompt);
}

const fixture = process.env.CURSOR_AGENT_STUB_FIXTURE;
if (!fixture) {
  process.stderr.write('stub: CURSOR_AGENT_STUB_FIXTURE not set\n');
  process.exit(2);
}

let content;
try {
  content = readFileSync(fixture, 'utf8');
} catch (err) {
  process.stderr.write(`stub: failed to read fixture ${fixture}: ${err.message}\n`);
  process.exit(2);
}

const lines = content.split('\n').filter((l) => l.length > 0);
let failure = false;
for (const line of lines) {
  process.stdout.write(line + '\n');
  try {
    const parsed = JSON.parse(line);
    if (parsed && parsed.type === 'result' && parsed.is_error === true) {
      failure = true;
    }
  } catch {
    /* noop */
  }
}

if (process.env.CURSOR_AGENT_STUB_HANG === '1') {
  // Simulate cursor-agent not self-exiting after `result`.
  setInterval(() => {}, 1_000);
} else {
  process.exit(failure ? 1 : 0);
}
