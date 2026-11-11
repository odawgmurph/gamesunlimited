/**
 * The game list. To add a game, create src/games/<id>/manifest.js and add it here.
 * See docs/ADDING_A_GAME.md.
 */
import wordbomb from './wordbomb/manifest.js';
import mafia from './mafia/manifest.js';

export const GAMES = [wordbomb, mafia];
