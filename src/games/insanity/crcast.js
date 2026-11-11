/**
 * CrCast (crcast.cc) deck import. CrCast is the community successor to
 * CardCast: every public deck has a 5-character code, and its API serves the
 * deck in the CardCast-compatible shape that Pretend You're Xyzzy reads:
 *
 *   GET https://api.crcast.cc/v1/cc/decks/{CODE}/all
 *   { error: 0, name, description, watermark,
 *     calls:     [{ text: ["Step 1: ", ". Step 2: ", "."] }],   // segments around blanks
 *     responses: [{ text: ["A white card."] }] }
 *   on failure: { error: <non-zero>, message }
 *
 * Browsers try our same-origin proxy (/api/crcast, see api/crcast.js) first,
 * because CrCast doesn't promise CORS headers, and fall back to calling CrCast
 * directly. Fetched decks are cached in memory and localStorage so that
 * whoever ends up hosting can start the game without waiting.
 */

export const CODE_RE = /^[A-Z0-9]{5}$/;
const API = 'https://api.crcast.cc/v1/cc/decks';
const STORE_PREFIX = 'gu.crcast.';
const MAX_CARDS = 3000;

/** Accepts a bare code ("ABC12") or a link containing one. Returns the code or null. */
export function normalizeCode(input) {
  const s = String(input || '').trim();
  if (CODE_RE.test(s.toUpperCase())) return s.toUpperCase();
  // In a link, prefer an upper-case match ("…/decks/4XK2P/all" also contains "decks").
  const found = [...s.matchAll(/(?:[?&#](?:id|deck|code)=|\/)([A-Za-z0-9]{5})(?=$|[/?#&])/g)].map((m) => m[1]);
  const pick = found.filter((c) => c === c.toUpperCase()).pop() || found.pop();
  return pick ? pick.toUpperCase() : null;
}

function clean(text, max) {
  return String(text ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .replace(/_{2,}/g, '____')
    .replace(/[ ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
    .slice(0, max);
}

/**
 * Normalises a CrCast response into { code, name, description, black: [[text, pick, draw]], white: [text] }.
 * Handles the CardCast-style `/cc/decks/{code}/all` shape and, defensively,
 * CrCast's native `{ deck: { blacks, whites } }` shape.
 */
export function parseCrCast(json, code) {
  if (!json || typeof json !== 'object') throw new Error('CrCast sent something that isn’t a deck.');
  if (json.error && Number(json.error) !== 0) throw new Error(json.message ? `CrCast: ${json.message}` : `Deck ${code} wasn’t found.`);
  const black = [];
  const white = [];
  if (Array.isArray(json.calls) && Array.isArray(json.responses)) {
    for (const c of json.calls.slice(0, MAX_CARDS)) {
      const parts = Array.isArray(c?.text) ? c.text.map(String) : [String(c?.text ?? '')];
      const text = clean(parts.join('____'), 400);
      if (text.replace(/_/g, '').trim()) black.push([text, Math.max(1, Math.min(5, parts.length - 1)), 0]);
    }
    for (const r of json.responses.slice(0, MAX_CARDS)) {
      const text = clean(Array.isArray(r?.text) ? r.text.join('') : r?.text, 250);
      if (text) white.push(text);
    }
  } else {
    const d = json.deck && typeof json.deck === 'object' ? json.deck : json;
    if (!Array.isArray(d.blacks) || !Array.isArray(d.whites)) throw new Error('CrCast sent something that isn’t a deck.');
    for (const c of d.blacks.slice(0, MAX_CARDS)) {
      // The native format marks blanks with runs of one or more underscores.
      const text = clean(String((typeof c === 'string' ? c : c?.text) ?? '').replace(/_+/g, '____'), 400);
      if (!text) continue;
      const blanks = (text.match(/____/g) || []).length;
      black.push([text, Math.max(1, Math.min(5, Number(c?.pick) || blanks || 1)), 0]);
    }
    for (const w of d.whites.slice(0, MAX_CARDS)) {
      const text = clean(typeof w === 'string' ? w : w?.text, 250);
      if (text) white.push(text);
    }
    json = d;
  }
  if (!black.length && !white.length) throw new Error(`Deck ${code} has no cards.`);
  return {
    code,
    name: clean(json.name, 80) || `Deck ${code}`,
    description: clean(json.description, 300),
    black,
    white,
  };
}

// ---------------------------------------------------------------- cache

const memory = new Map(); // code -> parsed deck
const inflight = new Map(); // code -> Promise

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

/** The deck if this browser already has it, otherwise null. Synchronous. */
export function getCachedDeck(code) {
  if (memory.has(code)) return memory.get(code);
  try {
    const raw = storage()?.getItem(STORE_PREFIX + code);
    if (raw) {
      const deck = JSON.parse(raw);
      memory.set(code, deck);
      return deck;
    }
  } catch {
    // ignore unreadable cache
  }
  return null;
}

function remember(deck) {
  memory.set(deck.code, deck);
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(STORE_PREFIX + deck.code, JSON.stringify(deck));
  } catch {
    // Storage full: drop other cached decks and try once more.
    try {
      for (let i = ls.length - 1; i >= 0; i--) {
        const k = ls.key(i);
        if (k?.startsWith(STORE_PREFIX) && k !== STORE_PREFIX + deck.code) ls.removeItem(k);
      }
      ls.setItem(STORE_PREFIX + deck.code, JSON.stringify(deck));
    } catch {
      // memory cache only
    }
  }
}

async function getJson(url, signal) {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    const err = new Error(res.ok ? 'not json' : `HTTP ${res.status}`);
    err.fallback = true; // e.g. a static host answering /api/* with index.html
    throw err;
  }
  if (json && json.proxyError) {
    const err = new Error(json.message || 'proxy failed');
    err.fallback = true;
    throw err;
  }
  if (!res.ok && !(json && json.error)) {
    const err = new Error(res.status === 404 ? 'not found' : `HTTP ${res.status}`);
    err.notFound = res.status === 404;
    throw err;
  }
  return json;
}

async function download(code) {
  const signal = AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined;
  let json;
  try {
    json = await getJson(`/api/crcast?code=${code}`, signal);
  } catch (err) {
    if (!err.fallback && !(err instanceof TypeError)) throw friendly(err, code);
    try {
      json = await getJson(`${API}/${code}/all`, signal);
    } catch (err2) {
      throw friendly(err2, code);
    }
  }
  return parseCrCast(json, code);
}

function friendly(err, code) {
  if (err.notFound) return new Error(`No CrCast deck with code ${code}.`);
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return new Error('CrCast took too long to answer. Try again.');
  if (err instanceof TypeError || err.fallback) return new Error('Couldn’t reach CrCast. Check your connection and try again.');
  return err;
}

/** Fetches a deck (or returns the cached copy). Concurrent calls share one request. */
export function ensureDeck(code) {
  const cached = getCachedDeck(code);
  if (cached) return Promise.resolve(cached);
  if (!inflight.has(code)) {
    const p = download(code).then(
      (deck) => {
        inflight.delete(code);
        remember(deck);
        return deck;
      },
      (err) => {
        inflight.delete(code);
        throw err;
      }
    );
    inflight.set(code, p);
  }
  return inflight.get(code);
}
