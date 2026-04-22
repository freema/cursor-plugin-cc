import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as browserMain } from '../scripts/browser.mjs';
import { listJobs } from '../scripts/lib/jobs.mjs';
import {
  BROWSER_FALLBACK_FIXTURE,
  BROWSER_HAPPY_FIXTURE,
  BROWSER_HAPPY_NESTED_FIXTURE,
  STUB_BIN,
  makeTempHome,
} from './helpers.mjs';

describe('browser', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFix = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevCwd = process.cwd();

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = BROWSER_HAPPY_FIXTURE;
    process.chdir(tmp.dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFix === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFix;
    tmp.cleanup();
  });

  it('refuses when description is empty', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await browserMain(['--no-git-check', '--skip-mcp-check', '--', '']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('accepts description without a URL and lets Cursor auto-discover', async () => {
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await browserMain([
        '--no-git-check',
        '--skip-mcp-check',
        '--',
        'please verify the app loads on localhost',
      ]);
      expect(code).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    const job = jobs[0];
    expect(job.prompt).toContain('(discover)');
  });

  it('happy path: chrome-devtools MCP calls → status done', async () => {
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await browserMain([
        '--no-git-check',
        '--skip-mcp-check',
        '--',
        'localhost:3000 verify the homepage shows a login button',
      ]);
      expect(code).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    const job = jobs[0];
    expect(job.status).toBe('done');
    expect(job.prompt).toContain('BROWSER');
    expect(job.prompt).toContain('http://localhost:3000');
    expect(job.cursorChatId).toBe('chat_browser_001');
  });

  it('happy path: nested tool_use blocks (realistic Cursor schema) are detected', async () => {
    process.env.CURSOR_AGENT_STUB_FIXTURE = BROWSER_HAPPY_NESTED_FIXTURE;
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await browserMain([
        '--no-git-check',
        '--skip-mcp-check',
        '--',
        'http://localhost:3002 verify homepage loads',
      ]);
      expect(code).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    const job = jobs[0];
    expect(job.status).toBe('done');
    expect(job.summary ?? '').not.toMatch(/post-flight/i);
  });

  it('post-flight: curl fallback is flagged in the job record even when shell exits 0', async () => {
    process.env.CURSOR_AGENT_STUB_FIXTURE = BROWSER_FALLBACK_FIXTURE;
    const outSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await browserMain([
        '--no-git-check',
        '--skip-mcp-check',
        '--',
        'http://localhost:3000 verify page loads',
      ]);
      expect(code).toBe(0);
    } finally {
      outSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    const job = jobs[0];
    expect(job.status).toBe('failed');
    expect(job.summary).toMatch(/post-flight/i);
    expect(job.summary).toMatch(/curl/i);
  });
});
