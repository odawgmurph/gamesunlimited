import { DEFAULT_DECKS, sanitizeDecks } from './decks.js';
import { DeckPicker } from './DeckPicker.jsx';

/** @type {import('../types').GameManifest} */
export default {
  id: 'insanity',
  name: 'Cards with Insanity',
  icon: '🂠',
  color: '#171717',
  tagline: 'Fill in the blank with the worst thing you’re holding. The Card Czar judges.',
  minPlayers: 3,
  // Rando Cardrissian counts as the third player.
  minPlayersFor: (s) => (s.rando ? 2 : 3),
  maxPlayers: 20,
  rules: [
    'Everyone holds a hand of white cards. Each round one player is the Card Czar and reads out a black card.',
    'Everyone else plays the white card (or cards, on a “Pick 2”) that best fills the blank. Plays are anonymous.',
    'The Czar reads them all and picks a favourite. Whoever played it scores a point, and the Czar passes to the next player.',
    'First to the score limit wins. Pick card decks below, including any CrCast deck by its 5-character code.',
    'Blank cards let you write your own answer. Rando Cardrissian plays random cards every round; if he wins, everyone goes home in shame.',
  ],
  settings: [
    { key: 'decks', label: 'Decks', type: 'custom', default: DEFAULT_DECKS, sanitize: sanitizeDecks, component: DeckPicker },
    { key: 'scoreLimit', label: 'Score limit', type: 'number', min: 1, max: 30, default: 8, suffix: ' pts' },
    { key: 'handSize', label: 'Cards in hand', type: 'number', min: 5, max: 15, default: 10 },
    {
      key: 'timer',
      label: 'Round timer',
      type: 'select',
      default: 'normal',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'normal', label: 'Normal' },
        { value: 'slow', label: 'Relaxed' },
        { value: 'off', label: 'No timer' },
      ],
      help: 'Normal: 45s to play, about 30s for the Czar',
    },
    { key: 'blanks', label: 'Blank cards', type: 'number', min: 0, max: 30, default: 0, help: 'Write-in cards shuffled into the deck' },
    { key: 'rando', label: 'Rando Cardrissian', type: 'toggle', default: false, help: 'A bot who plays random cards' },
    { key: 'reboot', label: 'Rebooting the Universe', type: 'toggle', default: false, help: 'Trade in a point to swap your whole hand' },
  ],
  load: () => import('./game.js'),
};
