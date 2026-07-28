import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setConfigValue } from '../scripts/lib/config.mjs';
import { handleStop, parseGateOutput } from '../scripts/stop-review-gate-hook.mjs';
import { STUB_BIN, makeTempHome } from './helpers.mjs';

const GATE_ALLOW_FIXTURE = new URL('./fixtures/cursor-events/gate-allow.ndjson', import.meta.url)
  .pathname;
const GATE_BLOCK_FIXTURE = new URL('./fixtures/cursor-events/gate-block.ndjson', import.meta.url)
  .pathname;

describe('stop review gate', () => {
  let tmp;
  let stdout;
  let stderr;
  const io = {
    out: (s) => {
      stdout += s;
    },
    err: (s) => {
      stderr += s;
    },
  };
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFix = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevAuth = process.env.CURSOR_AGENT_STUB_AUTH;

  beforeEach(() => {
    tmp = makeTempHome();
    stdout = '';
    stderr = '';
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = GATE_ALLOW_FIXTURE;
    delete process.env.CURSOR_AGENT_STUB_AUTH;
  });

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFix === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFix;
    if (prevAuth === undefined) delete process.env.CURSOR_AGENT_STUB_AUTH;
    else process.env.CURSOR_AGENT_STUB_AUTH = prevAuth;
    tmp.cleanup();
  });

  describe('parseGateOutput', () => {
    it('accepts ALLOW and BLOCK first lines, with markdown tolerance', () => {
      expect(parseGateOutput('ALLOW: fine').ok).toBe(true);
      expect(parseGateOutput('**ALLOW: fine**').ok).toBe(true);
      const block = parseGateOutput('BLOCK: missing test\nmore detail');
      expect(block.ok).toBe(false);
      expect(block.reason).toContain('missing test');
    });

    it('treats anything else as unexpected (fails closed)', () => {
      const res = parseGateOutput('I reviewed the code and it looks good.');
      expect(res.ok).toBe(false);
      expect(res.reason).toContain('unexpected answer');
    });
  });

  it('does nothing when the gate is disabled', async () => {
    await handleStop({ cwd: tmp.dir }, io);
    expect(stdout).toBe('');
  });

  it('short-circuits when stop_hook_active is set (no loop)', async () => {
    setConfigValue(tmp.dir, 'stopReviewGate', true);
    await handleStop({ cwd: tmp.dir, stop_hook_active: true }, io);
    expect(stdout).toBe('');
  });

  it('allows silently on an ALLOW verdict', async () => {
    setConfigValue(tmp.dir, 'stopReviewGate', true);
    await handleStop({ cwd: tmp.dir, last_assistant_message: 'edited foo.ts' }, io);
    expect(stdout).toBe('');
  });

  it('emits a block decision on a BLOCK verdict', async () => {
    setConfigValue(tmp.dir, 'stopReviewGate', true);
    process.env.CURSOR_AGENT_STUB_FIXTURE = GATE_BLOCK_FIXTURE;
    await handleStop({ cwd: tmp.dir, last_assistant_message: 'edited foo.ts' }, io);
    const decision = JSON.parse(stdout);
    expect(decision.decision).toBe('block');
    expect(decision.reason).toContain('timeout path has no test');
  });

  it('degrades to a stderr note when Cursor CLI is logged out', async () => {
    setConfigValue(tmp.dir, 'stopReviewGate', true);
    process.env.CURSOR_AGENT_STUB_AUTH = 'out';
    await handleStop({ cwd: tmp.dir }, io);
    expect(stdout).toBe('');
    expect(stderr).toContain('cursor-agent login');
  });
});
