#!/usr/bin/env node
// Test stub for `cursor-agent`. Emits a fixture NDJSON stream chosen by
// the CURSOR_AGENT_STUB_FIXTURE env var, then exits.
import { readFileSync } from 'node:fs';

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
