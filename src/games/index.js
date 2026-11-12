/**
 * The game list. To add a game, create src/games/<id>/manifest.js and add it here.
 * See docs/ADDING_A_GAME.md.
 */
import wordbomb from './wordbomb/manifest.js';
import mafia from './mafia/manifest.js';
import single from './single/manifest.js';
import insanity from './insanity/manifest.js';
import quips from './quips/manifest.js';

export const GAMES = [wordbomb, mafia, single, insanity, quips];
