import { logic } from './logic.js';
import { View } from './View.jsx';

/** Loads the dictionary and prompt table. Every player loads them since anyone may become host. */
export async function prepare() {
  const [words, prompts] = await Promise.all([
    fetch('/games/wordbomb/words.txt').then((r) => {
      if (!r.ok) throw new Error('dictionary missing');
      return r.text();
    }),
    fetch('/games/wordbomb/prompts.json').then((r) => r.json()),
  ]);
  return { dictionary: new Set(words.split('\n')), prompts };
}

export { logic, View };
