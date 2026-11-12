/**
 * The "Your own prompts" setting: one prompt per line, kept as a single string
 * so it stays small when the lobby broadcasts it.
 */
export const MAX_PROMPT = 160;
export const MAX_CUSTOM = 200;

/** Splits the setting into clean, de-duplicated prompts. */
export function parsePrompts(text) {
  const seen = new Set();
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const t = cleanPrompt(raw);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function cleanPrompt(raw) {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PROMPT);
}

/** Runs on the host for every change: keeps the line structure, trims the rest. */
export function sanitizeCustom(v) {
  const lines = String(v ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    // eslint-disable-next-line no-control-regex
    .map((l) => l.replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, ' ').slice(0, MAX_PROMPT));
  return lines.slice(0, MAX_CUSTOM + 20).join('\n');
}
