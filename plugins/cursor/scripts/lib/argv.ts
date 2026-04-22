import yargsParser from 'yargs-parser';

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, unknown>;
}

export function splitArgString(arg: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let escape = false;
  for (let i = 0; i < arg.length; i += 1) {
    const ch = arg[i];
    if (ch === undefined) continue;
    if (escape) {
      cur += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        quote = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (cur.length > 0) {
        out.push(cur);
        cur = '';
      }
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

export function parseArgv(argv: string[], booleans: string[] = []): ParsedArgs {
  const parsed = yargsParser(argv, {
    configuration: {
      'populate--': false,
      'halt-at-non-option': false,
      'camel-case-expansion': true,
      'boolean-negation': true,
    },
    boolean: booleans,
  });
  const flags: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (k === '_') continue;
    flags[k] = v;
  }
  const positional = (parsed._ ?? []).map((v) => String(v));
  return { positional, flags };
}

export function collapseArguments(raw: string | undefined): string[] {
  if (!raw || raw.trim().length === 0) return [];
  return splitArgString(raw.trim());
}
