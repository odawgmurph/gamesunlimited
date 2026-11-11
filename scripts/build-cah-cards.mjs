// Converts Pretend You're Xyzzy's card database (data/pyx/cah_cards.sql, a
// PostgreSQL dump) into public/games/insanity/pyx-cards.json for Cards with Insanity.
// Runs automatically before `npm run dev` and `npm run build` (including on Vercel).
//
// Output shape:
//   {
//     sets:  [{ id, name, b: [blackIndex...], w: [whiteIndex...] }],  // in PYX's display order
//     black: [[text, pick, draw], ...],
//     white: [text, ...]
//   }
// Card text is plain text with "\n" for line breaks, "____" for blanks and
// <i>…</i> as the only markup (see src/games/insanity/text.jsx).
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  reg: '®', trade: '™', copy: '©', pound: '£', eacute: 'é', ntilde: 'ñ',
  rarr: '→', larr: '←', darr: '↓', uarr: '↑', hellip: '…', mdash: '—', ndash: '–',
};

/** Undoes PostgreSQL COPY text-format escaping. */
function unescapeCopy(s) {
  if (s === '\\N') return null;
  return s.replace(/\\(.)/g, (_, c) => ({ t: '\t', n: '\n', r: '\r', b: '\b', f: '\f', v: '\v' })[c] ?? c);
}

/** PYX stores HTML. Keep italics and line breaks, drop other tags, decode entities. */
export function cleanText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(\/?)(i|em)>/gi, '\u0001$1\u0002')
    .replace(/<[^>]*>/g, '')
    .replace(/\u0001(\/?)\u0002/g, '<$1i>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/_{2,}/g, '____')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/<\/i> ([,:;.!?)])/g, '</i>$1')
    .replace(/\( <i>/g, '(<i>')
    .trim();
}

/** Pulls every `COPY table (cols) FROM stdin; ... \.` block out of a pg_dump. */
function copyBlocks(sql) {
  const tables = {};
  const re = /^COPY (\w+) \(([^)]*)\) FROM stdin;\n([\s\S]*?)^\\\.$/gm;
  let m;
  while ((m = re.exec(sql))) {
    const cols = m[2].split(',').map((c) => c.trim());
    tables[m[1]] = m[3]
      .split('\n')
      .filter(Boolean)
      .map((line) => Object.fromEntries(line.split('\t').map((v, i) => [cols[i], unescapeCopy(v)])));
  }
  return tables;
}

export function convertPyxSql(sql) {
  const t = copyBlocks(sql);
  const sets = t.card_set
    .filter((s) => s.active === 't')
    .sort((a, b) => Number(a.weight) - Number(b.weight) || a.name.localeCompare(b.name));

  const black = [];
  const white = [];
  const blackIndex = new Map();
  const whiteIndex = new Map();
  const blackById = new Map(t.black_cards.map((c) => [c.id, c]));
  const whiteById = new Map(t.white_cards.map((c) => [c.id, c]));

  const blackFor = (id) => {
    if (!blackIndex.has(id)) {
      const c = blackById.get(id);
      if (!c) return null;
      blackIndex.set(id, black.length);
      black.push([cleanText(c.text), Math.max(1, Number(c.pick)), Number(c.draw) || 0]);
    }
    return blackIndex.get(id);
  };
  const whiteFor = (id) => {
    if (!whiteIndex.has(id)) {
      const c = whiteById.get(id);
      if (!c) return null;
      whiteIndex.set(id, white.length);
      white.push(cleanText(c.text));
    }
    return whiteIndex.get(id);
  };

  const out = sets.map((s) => ({
    id: Number(s.id),
    name: s.name,
    b: t.card_set_black_card.filter((r) => r.card_set_id === s.id).map((r) => blackFor(r.black_card_id)).filter((i) => i != null),
    w: t.card_set_white_card.filter((r) => r.card_set_id === s.id).map((r) => whiteFor(r.white_card_id)).filter((i) => i != null),
  }));
  return { sets: out.filter((s) => s.b.length || s.w.length), black, white };
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const src = join(root, 'data', 'pyx', 'cah_cards.sql');
  const outDir = join(root, 'public', 'games', 'insanity');
  const out = join(outDir, 'pyx-cards.json');
  const self = fileURLToPath(import.meta.url);
  if (existsSync(out) && statSync(out).mtimeMs > Math.max(statSync(src).mtimeMs, statSync(self).mtimeMs)) {
    console.log('[cah-cards] up to date');
  } else {
    const data = convertPyxSql(readFileSync(src, 'utf8'));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(out, JSON.stringify(data));
    console.log(`[cah-cards] ${data.sets.length} sets, ${data.black.length} black, ${data.white.length} white`);
  }
}
