import { execa } from 'execa';

export async function isGitRepo(cwd: string = process.cwd()): Promise<boolean> {
  try {
    const res = await execa('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      reject: false,
      timeout: 3_000,
    });
    return res.exitCode === 0 && String(res.stdout ?? '').trim() === 'true';
  } catch {
    return false;
  }
}

export async function repoRoot(cwd: string = process.cwd()): Promise<string> {
  try {
    const res = await execa('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      reject: false,
      timeout: 3_000,
    });
    if (res.exitCode === 0) return String(res.stdout ?? '').trim() || cwd;
  } catch {
    /* noop */
  }
  return cwd;
}
