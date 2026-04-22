import { z } from 'zod';

const BaseEvent = z
  .object({
    type: z.string().optional(),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
    sessionId: z.string().optional(),
    chat_id: z.string().optional(),
    chatId: z.string().optional(),
  })
  .passthrough();

export type CursorEvent = z.infer<typeof BaseEvent>;

export function parseLine(line: string): CursorEvent | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed == null || typeof parsed !== 'object') return null;
    return BaseEvent.parse(parsed);
  } catch {
    return null;
  }
}

const CHAT_ID_KEYS = ['chat_id', 'chatId', 'session_id', 'sessionId'] as const;

function dig(obj: unknown, keys: readonly string[]): string | undefined {
  if (obj == null || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  for (const v of Object.values(rec)) {
    const found = dig(v, keys);
    if (found) return found;
  }
  return undefined;
}

export function extractChatId(events: CursorEvent[]): string | undefined {
  for (const ev of events) {
    const id = dig(ev, CHAT_ID_KEYS);
    if (id) return id;
  }
  return undefined;
}

const WRITE_TOOL_HINTS = [
  'write',
  'edit',
  'str_replace',
  'create_file',
  'patch',
  'apply_patch',
  'file_write',
];

function looksLikeFileWrite(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  const lower = name.toLowerCase();
  return WRITE_TOOL_HINTS.some((h) => lower.includes(h));
}

function pickString(obj: unknown, keys: readonly string[]): string | undefined {
  if (obj == null || typeof obj !== 'object') return undefined;
  const rec = obj as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

export interface Summary {
  summary: string;
  filesTouched: string[];
  exitReason: string;
  success: boolean;
}

function* walkToolUses(node: unknown): Iterable<{ name: string; input: unknown }> {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) yield* walkToolUses(item);
    return;
  }
  const obj = node as Record<string, unknown>;
  const type = obj['type'];
  const name = typeof obj['name'] === 'string' ? (obj['name'] as string) : undefined;
  if ((type === 'tool_use' || type === 'tool_call') && name) {
    yield {
      name,
      input: obj['input'] ?? obj['arguments'] ?? obj['params'] ?? obj['tool_input'],
    };
  }
  for (const v of Object.values(obj)) yield* walkToolUses(v);
}

export function summariseEvents(events: CursorEvent[]): Summary {
  const files = new Set<string>();
  let finalText: string | undefined;
  let success = true;
  let exitReason = 'completed';

  for (const ev of events) {
    for (const tu of walkToolUses(ev)) {
      if (!looksLikeFileWrite(tu.name)) continue;
      const path = pickString(tu.input, [
        'path',
        'file_path',
        'filename',
        'file',
        'target',
        'target_file',
      ]);
      if (path) files.add(path);
    }
    const type = ev['type'];
    if (type === 'result') {
      const text =
        pickString(ev, ['result', 'text', 'message', 'content']) ??
        pickString(ev['message'], ['text', 'content']);
      if (text) finalText = text;
      const subtype = typeof ev['subtype'] === 'string' ? (ev['subtype'] as string) : undefined;
      const isError = ev['is_error'] === true || ev['error'] != null;
      if (subtype && subtype !== 'success') {
        exitReason = subtype;
        if (subtype.includes('error') || subtype.includes('fail')) success = false;
      }
      if (isError) {
        success = false;
        exitReason = 'error';
      }
    }
  }

  if (!finalText) {
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev) continue;
      const type = ev['type'];
      if (type === 'assistant' || type === 'message') {
        const text =
          pickString(ev, ['text', 'content', 'message']) ??
          pickString(ev['message'], ['text', 'content']);
        if (text) {
          finalText = text;
          break;
        }
      }
    }
  }

  const summary = finalText ?? '(no final message captured)';
  return {
    summary: summary.slice(0, 4000),
    filesTouched: [...files],
    exitReason,
    success,
  };
}
