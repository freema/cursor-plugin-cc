import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './run.mjs';

/**
 * @param {string} [cwd]
 * @returns {Promise<boolean>}
 */
export async function isGitRepo(cwd = process.cwd()) {
  const res = await run('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd,
    timeoutMs: 3_000,
  });
  return res.exitCode === 0 && res.stdout.trim() === 'true';
}

/**
 * @param {string} [cwd]
 * @returns {Promise<string>}
 */
export async function repoRoot(cwd = process.cwd()) {
  const res = await run('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    timeoutMs: 3_000,
  });
  if (res.exitCode === 0) return res.stdout.trim() || cwd;
  return cwd;
}

// --- review-context collection ---------------------------------------------
// Helpers below gather the git state a code review needs (status, diff stat,
// diff body, untracked file contents) so the review prompt is self-contained
// and the reviewer never has to mutate the tree to see what changed.

const MAX_DIFF_BYTES = 256 * 1024;
const MAX_UNTRACKED_BYTES = 32 * 1024;

function git(cwd, args) {
  return run('git', args, { cwd, timeoutMs: 15_000 });
}

/**
 * @param {string} [cwd]
 * @returns {Promise<string>}
 */
export async function currentBranch(cwd = process.cwd()) {
  const res = await git(cwd, ['branch', '--show-current']);
  return res.stdout.trim() || 'HEAD';
}

/**
 * Best-effort detection of the repo's default branch. Returns null when none
 * of the usual suspects exist, so callers can ask the user for `--base`.
 *
 * @param {string} [cwd]
 * @returns {Promise<string|null>}
 */
export async function detectDefaultBranch(cwd = process.cwd()) {
  const sym = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  if (sym.exitCode === 0) {
    const head = sym.stdout.trim();
    if (head.startsWith('refs/remotes/origin/')) {
      return head.replace('refs/remotes/origin/', 'origin/');
    }
  }
  for (const cand of ['main', 'master', 'trunk']) {
    const local = await git(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${cand}`]);
    if (local.exitCode === 0) return cand;
    const remote = await git(cwd, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/remotes/origin/${cand}`,
    ]);
    if (remote.exitCode === 0) return `origin/${cand}`;
  }
  return null;
}

/**
 * @param {string} [cwd]
 * @returns {Promise<{staged: string[], unstaged: string[], untracked: string[], isDirty: boolean}>}
 */
export async function workingTreeStatus(cwd = process.cwd()) {
  const split = (s) => s.trim().split('\n').filter(Boolean);
  const staged = split((await git(cwd, ['diff', '--cached', '--name-only'])).stdout);
  const unstaged = split((await git(cwd, ['diff', '--name-only'])).stdout);
  const untracked = split((await git(cwd, ['ls-files', '--others', '--exclude-standard'])).stdout);
  return {
    staged,
    unstaged,
    untracked,
    isDirty: staged.length + unstaged.length + untracked.length > 0,
  };
}

function looksBinary(buf) {
  const len = Math.min(buf.length, 8_000);
  for (let i = 0; i < len; i += 1) if (buf[i] === 0) return true;
  return false;
}

function section(title, body) {
  const trimmed = (body ?? '').trim();
  return `## ${title}\n\n${trimmed ? trimmed : '(none)'}\n`;
}

function capDiff(diff, maxBytes) {
  if (Buffer.byteLength(diff, 'utf8') <= maxBytes) return { text: diff, truncated: false };
  const slice = Buffer.from(diff, 'utf8').subarray(0, maxBytes).toString('utf8');
  const lastNl = slice.lastIndexOf('\n');
  return { text: slice.slice(0, lastNl > 0 ? lastNl : slice.length), truncated: true };
}

function untrackedSection(cwd, files) {
  if (files.length === 0) return '(none)';
  const parts = [];
  for (const rel of files) {
    const abs = join(cwd, rel);
    let st;
    try {
      st = statSync(abs);
    } catch {
      parts.push(`### ${rel}\n(unreadable)`);
      continue;
    }
    if (st.isDirectory()) {
      parts.push(`### ${rel}/\n(directory — contents omitted)`);
      continue;
    }
    if (st.size > MAX_UNTRACKED_BYTES) {
      parts.push(
        `### ${rel}\n(skipped: ${st.size} bytes exceeds ${MAX_UNTRACKED_BYTES} byte limit)`,
      );
      continue;
    }
    let buf;
    try {
      buf = readFileSync(abs);
    } catch {
      parts.push(`### ${rel}\n(unreadable)`);
      continue;
    }
    if (looksBinary(buf)) {
      parts.push(`### ${rel}\n(binary file)`);
      continue;
    }
    parts.push([`### ${rel}`, '```', buf.toString('utf8').trimEnd(), '```'].join('\n'));
  }
  return parts.join('\n\n');
}

/**
 * @typedef {Object} ReviewContext
 * @property {'working-tree'|'branch'} [mode]
 * @property {string} [label]      Human-readable target description.
 * @property {string} [baseRef]
 * @property {string} [body]       Markdown diff context for the prompt.
 * @property {string[]} [changedFiles]
 * @property {boolean} [truncated]
 * @property {boolean} [isEmpty]   True when there is nothing to review.
 * @property {string} [error]      Set when the target could not be resolved.
 */

/**
 * Resolve and collect the git context for a review.
 *
 * @param {string} cwd
 * @param {{scope?: 'auto'|'working-tree'|'branch', base?: string|null, maxDiffBytes?: number}} [opts]
 * @returns {Promise<ReviewContext>}
 */
export async function collectReviewContext(cwd, opts = {}) {
  const scope = opts.scope ?? 'auto';
  const base = opts.base ?? null;
  const maxDiffBytes = opts.maxDiffBytes ?? MAX_DIFF_BYTES;
  const branch = await currentBranch(cwd);

  let mode;
  let baseRef = base;
  if (base) {
    mode = 'branch';
  } else if (scope === 'working-tree') {
    mode = 'working-tree';
  } else if (scope === 'branch') {
    mode = 'branch';
    baseRef = await detectDefaultBranch(cwd);
  } else {
    const st = await workingTreeStatus(cwd);
    if (st.isDirty) {
      mode = 'working-tree';
    } else {
      mode = 'branch';
      baseRef = await detectDefaultBranch(cwd);
    }
  }

  if (mode === 'branch' && !baseRef) {
    return {
      error: 'Could not detect a default branch. Pass --base <ref> or use --scope working-tree.',
    };
  }

  if (mode === 'working-tree') {
    const st = await workingTreeStatus(cwd);
    const changedFiles = [...new Set([...st.staged, ...st.unstaged, ...st.untracked])].sort();
    if (!st.isDirty) {
      return { mode, label: `working tree on ${branch}`, changedFiles: [], isEmpty: true };
    }
    const status = (await git(cwd, ['status', '--short', '--untracked-files=all'])).stdout.trim();
    const stat = (await git(cwd, ['diff', '--stat', 'HEAD'])).stdout.trim();
    const { text: diff, truncated } = capDiff(
      (await git(cwd, ['diff', '--no-ext-diff', 'HEAD'])).stdout,
      maxDiffBytes,
    );
    const body = [
      section('Status', status),
      section('Diff stat', stat),
      section(
        'Diff (tracked files vs HEAD)',
        diff + (truncated ? '\n\n…[diff truncated — inspect the remaining files read-only]…' : ''),
      ),
      section('Untracked files', untrackedSection(cwd, st.untracked)),
    ].join('\n');
    return {
      mode,
      label: `working tree on ${branch} (${changedFiles.length} file(s))`,
      body,
      changedFiles,
      truncated,
      isEmpty: false,
    };
  }

  const mb = await git(cwd, ['merge-base', 'HEAD', baseRef]);
  if (mb.exitCode !== 0) {
    return { error: `Could not compute a merge-base with "${baseRef}". Is it a valid ref?` };
  }
  const range = `${baseRef}...HEAD`;
  const changedFiles = (await git(cwd, ['diff', '--name-only', range])).stdout
    .trim()
    .split('\n')
    .filter(Boolean);
  if (changedFiles.length === 0) {
    return { mode, label: `${branch} vs ${baseRef}`, baseRef, changedFiles: [], isEmpty: true };
  }
  const log = (
    await git(cwd, ['log', '--oneline', '--no-decorate', `${baseRef}..HEAD`])
  ).stdout.trim();
  const stat = (await git(cwd, ['diff', '--stat', range])).stdout.trim();
  const { text: diff, truncated } = capDiff(
    (await git(cwd, ['diff', '--no-ext-diff', range])).stdout,
    maxDiffBytes,
  );
  const body = [
    section('Commits', log),
    section('Diff stat', stat),
    section(
      `Diff (${range})`,
      diff + (truncated ? '\n\n…[diff truncated — inspect the remaining files read-only]…' : ''),
    ),
  ].join('\n');
  return {
    mode,
    label: `${branch} vs ${baseRef} (${changedFiles.length} file(s))`,
    baseRef,
    body,
    changedFiles,
    truncated,
    isEmpty: false,
  };
}
