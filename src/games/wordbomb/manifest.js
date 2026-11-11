/** @type {import('../types').GameManifest} */
export default {
  id: 'wordbomb',
  name: 'Short Fuse',
  icon: '💣',
  color: '#ff7a45',
  tagline: 'Type a word containing the letters before the bomb goes off.',
  minPlayers: 1,
  maxPlayers: 16,
  rules: [
    'The bomb shows a few letters, like "ing". On your turn, type any word that contains them and press Enter.',
    'Words can only be used once per game.',
    "The bomb's fuse is hidden and random. If it blows up on your turn, you lose a life.",
    'Use every letter of the bonus alphabet across your words to earn an extra life.',
    'Last one standing wins.',
  ],
  settings: [
    { key: 'startLives', label: 'Starting lives', type: 'number', min: 1, max: 5, default: 2 },
    { key: 'maxLives', label: 'Max lives', type: 'number', min: 1, max: 8, default: 3 },
    {
      key: 'difficulty',
      label: 'Prompt difficulty',
      type: 'select',
      default: 'medium',
      options: [
        { value: 'easy', label: 'Easy (2000+ words each)' },
        { value: 'medium', label: 'Medium (500+ words each)' },
        { value: 'hard', label: 'Hard (150+ words each)' },
        { value: 'brutal', label: 'Brutal (50+ words each)' },
      ],
    },
    { key: 'minTurn', label: 'Minimum turn time', type: 'number', min: 2, max: 20, default: 5, suffix: 's', help: 'You always get at least this long on your turn.' },
    { key: 'fuseMin', label: 'Fuse length (min)', type: 'number', min: 5, max: 60, default: 10, suffix: 's' },
    { key: 'fuseMax', label: 'Fuse length (max)', type: 'number', min: 5, max: 90, default: 30, suffix: 's' },
    { key: 'promptLife', label: 'Explosions before new letters', type: 'number', min: 1, max: 5, default: 2 },
    {
      key: 'bonus',
      label: 'Bonus alphabet',
      type: 'select',
      default: 'standard',
      options: [
        { value: 'standard', label: 'A–V without K (21 letters)' },
        { value: 'full', label: 'Full A–Z' },
        { value: 'off', label: 'Off' },
      ],
    },
  ],
  load: () => import('./game.js'),
};
