import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeTempHome(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-plugin-cc-test-'));
  return {
    dir,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export const STUB_BIN = new URL('./fixtures/cursor-agent-stub.mjs', import.meta.url).pathname;
export const HAPPY_FIXTURE = new URL('./fixtures/cursor-events/happy-path.ndjson', import.meta.url)
  .pathname;
export const FAILURE_FIXTURE = new URL('./fixtures/cursor-events/failure.ndjson', import.meta.url)
  .pathname;
export const BROWSER_HAPPY_FIXTURE = new URL(
  './fixtures/cursor-events/browser-happy.ndjson',
  import.meta.url,
).pathname;
export const BROWSER_HAPPY_NESTED_FIXTURE = new URL(
  './fixtures/cursor-events/browser-happy-nested.ndjson',
  import.meta.url,
).pathname;
export const BROWSER_FALLBACK_FIXTURE = new URL(
  './fixtures/cursor-events/browser-fallback.ndjson',
  import.meta.url,
).pathname;
