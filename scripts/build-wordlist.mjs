// Builds the word-bomb dictionary and prompt table into public/games/wordbomb/.
// Runs automatically before `npm run dev` and `npm run build` (including on Vercel).
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'games', 'wordbomb');
const wordsOut = join(outDir, 'words.txt');
const promptsOut = join(outDir, 'prompts.json');

const srcPath = require.resolve('an-array-of-english-words/index.json');
if (existsSync(wordsOut) && existsSync(promptsOut) &&
    statSync(wordsOut).mtimeMs > statSync(srcPath).mtimeMs &&
    statSync(promptsOut).mtimeMs > statSync(fileURLToPath(import.meta.url)).mtimeMs) {
  console.log('[wordlist] up to date');
  process.exit(0);
}

const words = JSON.parse(readFileSync(srcPath, 'utf8'))
  .map((w) => w.toLowerCase())
  .filter((w) => /^[a-z]{2,}$/.test(w));
const unique = [...new Set(words)].sort();

// Count, for each 2- and 3-letter substring, how many words contain it.
const counts = new Map();
for (const w of unique) {
  const seen = new Set();
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= w.length; i++) seen.add(w.slice(i, i + n));
  }
  for (const s of seen) counts.set(s, (counts.get(s) || 0) + 1);
}
// Keep only prompts that have a reasonable number of solutions.
const prompts = {};
for (const [s, c] of [...counts].sort((a, b) => b[1] - a[1])) {
  if (c >= 50) prompts[s] = c;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(wordsOut, unique.join('\n'));
writeFileSync(promptsOut, JSON.stringify(prompts));
console.log(`[wordlist] ${unique.length} words, ${Object.keys(prompts).length} prompts`);
