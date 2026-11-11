import { logic } from './logic.js';
import { View } from './View.jsx';
import { loadPyx } from './pyx.js';
import { getCachedDeck } from './crcast.js';

export { logic, View };

/**
 * Runs on every player (anyone might become host). The official cards come
 * from the converted PYX database; imported CrCast decks are looked up in
 * this browser's cache, which the lobby's deck picker fills on every player.
 */
export async function prepare() {
  return { pyx: await loadPyx(), crcast: getCachedDeck };
}
