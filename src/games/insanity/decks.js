/**
 * The "Decks" setting: which Pretend You're Xyzzy sets are in play, plus any
 * CrCast decks the host imported. Only ids, codes and a little metadata live
 * in settings (they're broadcast with the lobby); the cards themselves come
 * from /games/insanity/pyx-cards.json and the CrCast cache.
 *
 *   { sets: [2, 235], crcast: [{ code: 'ABC12', name: 'My deck', b: 40, w: 200 }] }
 */
import { CODE_RE } from './crcast.js';

/** Base Game (US) plus the Red, Blue and Green box expansions. */
export const DEFAULT_SETS = [2, 235, 271, 342];
export const MAX_CRCAST = 12;

export const DEFAULT_DECKS = { sets: DEFAULT_SETS, crcast: [] };

export function sanitizeDecks(v) {
  const sets = [...new Set((Array.isArray(v?.sets) ? v.sets : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 200);
  const seen = new Set();
  const crcast = [];
  for (const d of Array.isArray(v?.crcast) ? v.crcast : []) {
    const code = String(d?.code || '').toUpperCase();
    if (!CODE_RE.test(code) || seen.has(code)) continue;
    seen.add(code);
    const count = (n) => Math.max(0, Math.min(99999, Math.floor(Number(n) || 0)));
    crcast.push({ code, name: String(d?.name || code).slice(0, 80), b: count(d?.b), w: count(d?.w) });
    if (crcast.length >= MAX_CRCAST) break;
  }
  return { sets, crcast };
}
