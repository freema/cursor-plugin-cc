// Helpers for reading Claude Code plan files and converting them into
// Cursor-oriented task files.
//
// Claude Code writes plans to `~/.claude/plans/<random-slug>.md` when the
// model exits plan mode. Each plan is free-form Markdown but in practice
// follows a recognisable shape:
//
//   # Title
//
//   ## Context      — why the change
//   ## Approach     — how (narrative, paragraphs + sections)
//   ## File-by-file change list   — files to touch
//   ## Critical files             — (alternative naming)
//   ## Verification               — how to check it worked
//   ## Effort / risks             — dev commentary (we drop this)
//
// We never REQUIRE any of those sections; the extractor degrades gracefully
// and falls back to a pass-through if it cannot parse enough structure.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export const PLANS_DIR = join(homedir(), '.claude', 'plans');

/**
 * @typedef {Object} ParsedPlan
 * @property {string} path                Absolute path to the source plan file.
 * @property {string} title               First `# ` heading text. May be empty.
 * @property {string} slug                kebab-case slug derived from title (or file stem).
 * @property {Object<string, string>} sections   Section body by lowercased heading key.
 * @property {string} raw                 Full file contents.
 */

/**
 * List available plan files sorted by mtime (newest first).
 *
 * @param {string} [plansDir]
 * @returns {Array<{ path: string, name: string, mtimeMs: number }>}
 */
export function listPlans(plansDir = PLANS_DIR) {
  if (!existsSync(plansDir)) return [];
  const entries = [];
  for (const name of readdirSync(plansDir)) {
    if (!name.endsWith('.md')) continue;
    const p = join(plansDir, name);
    try {
      const st = statSync(p);
      if (st.isFile()) entries.push({ path: p, name, mtimeMs: st.mtimeMs });
    } catch {
      continue;
    }
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return entries;
}

/**
 * Resolve an input identifier (absolute path, filename, or plan-name without
 * extension) to a real plan file path. Returns undefined if nothing matches.
 *
 * @param {string|undefined} ref
 * @param {string} [plansDir]
 * @returns {string|undefined}
 */
export function resolvePlanPath(ref, plansDir = PLANS_DIR) {
  if (!ref) {
    const latest = listPlans(plansDir)[0];
    return latest?.path;
  }
  // Absolute path.
  if (ref.startsWith('/') || /^[A-Za-z]:/.test(ref)) {
    return existsSync(ref) ? resolve(ref) : undefined;
  }
  // Relative path from CWD.
  const fromCwd = resolve(process.cwd(), ref);
  if (existsSync(fromCwd) && !fromCwd.endsWith('/')) return fromCwd;
  // Filename inside plans dir (with or without .md).
  const candidates = [join(plansDir, ref), join(plansDir, ref.endsWith('.md') ? ref : `${ref}.md`)];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  // Substring match against plan names.
  const needle = ref.toLowerCase();
  const match = listPlans(plansDir).find((p) => p.name.toLowerCase().includes(needle));
  return match?.path;
}

/**
 * Split a plan markdown into (heading → body) pairs keyed by lowercased heading.
 * Only `## ` headings are split — deeper headings stay inside the section body.
 *
 * @param {string} content
 * @returns {{ title: string, sections: Object<string, string> }}
 */
export function splitSections(content) {
  const lines = content.split('\n');
  /** @type {Object<string, string>} */
  const sections = {};
  let title = '';
  let currentKey = '';
  /** @type {string[]} */
  let buffer = [];
  const flush = () => {
    if (currentKey) {
      sections[currentKey] =
        (sections[currentKey] ? sections[currentKey] + '\n\n' : '') + buffer.join('\n').trim();
    }
    buffer = [];
  };
  for (const line of lines) {
    const h1 = /^#\s+(.+?)\s*$/.exec(line);
    if (h1 && !title) {
      title = h1[1].trim();
      continue;
    }
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) {
      flush();
      currentKey = h2[1].trim().toLowerCase();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return { title, sections };
}

/**
 * Read and parse a plan file.
 *
 * @param {string} path
 * @returns {ParsedPlan}
 */
export function parsePlanFile(path) {
  const raw = readFileSync(path, 'utf8');
  const { title, sections } = splitSections(raw);
  const slug = slugify(title || path.replace(/\.md$/, '').split('/').pop() || 'plan');
  return { path, title, slug, sections, raw };
}

/**
 * @param {string} s
 * @returns {string}
 */
export function slugify(s) {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return cleaned.slice(0, 50) || 'plan';
}

const SECTION_HINTS = {
  context: ['context', 'background', 'why', 'motivation'],
  approach: ['approach', 'plan', 'implementation', 'solution', 'design'],
  files: [
    'file-by-file change list',
    'files to touch',
    'files to modify',
    'critical files',
    'critical files to touch',
    'critical files to modify',
    'files',
  ],
  verification: ['verification', 'how to verify', 'test plan', 'tests', 'acceptance criteria'],
};

/**
 * Pick the first matching section for a given intent.
 *
 * @param {Object<string, string>} sections
 * @param {'context'|'approach'|'files'|'verification'} intent
 * @returns {string}
 */
export function pickSection(sections, intent) {
  const hints = SECTION_HINTS[intent];
  for (const key of Object.keys(sections)) {
    for (const hint of hints) {
      if (key === hint || key.startsWith(`${hint}:`) || key.startsWith(`${hint} `)) {
        return sections[key];
      }
    }
  }
  return '';
}

/**
 * Build the Cursor-friendly task file content from a parsed plan.
 *
 * @param {ParsedPlan} plan
 * @returns {string}
 */
export function buildTaskContent(plan) {
  const context = pickSection(plan.sections, 'context');
  const approach = pickSection(plan.sections, 'approach');
  const files = pickSection(plan.sections, 'files');
  const verification = pickSection(plan.sections, 'verification');

  const lines = [];
  lines.push(`# ${plan.title || 'Delegated task'}`);
  lines.push('');
  lines.push(`> Generated from Claude Code plan: \`${plan.path}\``);
  lines.push('');
  lines.push('## Goal');
  lines.push('');
  lines.push(plan.title ? plan.title : '(see Context below)');
  lines.push('');
  lines.push('## Repo context');
  lines.push('');
  lines.push(context || '(no Context section in the source plan)');
  lines.push('');
  lines.push('## Acceptance criteria');
  lines.push('');
  lines.push(approach || '(no Approach / Plan / Implementation section in the source plan)');
  lines.push('');
  if (files) {
    lines.push('## Files to touch');
    lines.push('');
    lines.push(files);
    lines.push('');
  }
  lines.push('## How to verify');
  lines.push('');
  lines.push(
    verification ||
      "- Run the project's test suite (`npm test`, `pnpm test`, `task test`, etc.).\n" +
        '- Run the type-check / lint if the project has one.\n' +
        '- Manual spot-check of the changed behaviour.',
  );
  lines.push('');
  lines.push('## Constraints');
  lines.push('');
  lines.push(
    '- Follow existing conventions in the target repo (read `AGENTS.md` / `.cursor/rules` / existing code).',
  );
  lines.push('- Do not touch files outside the list above unless the task explicitly requires it.');
  lines.push('- Do not rename public APIs unless the task asks for it.');
  lines.push(
    '- Do not modify lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`) unless dependencies are part of the task.',
  );
  lines.push('');
  return lines.join('\n');
}
