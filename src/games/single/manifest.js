/** @type {import('../types').GameManifest} */
export default {
  id: 'single',
  name: 'Single',
  icon: '🃏',
  color: '#2f6fd0',
  tagline: 'Match the color or the number, and be the first to empty your hand.',
  minPlayers: 2,
  maxPlayers: 10,
  rules: [
    'Everyone gets a hand of cards. On your turn, play one that matches the top card’s color or number/symbol, or draw a card.',
    'Skip makes the next player miss a turn, Reverse flips the direction, and +2 makes the next player draw two and miss their turn.',
    'Wild cards can go on anything and let you pick the new color. Wild +4 also makes the next player draw four.',
    'When you’re down to one card, hit “Single!”. If someone catches you first, you draw two.',
    'First to empty their hand wins the hand and scores the cards left in everyone else’s.',
  ],
  settings: [
    {
      key: 'target',
      label: 'Play to',
      type: 'select',
      default: '0',
      options: [
        { value: '0', label: 'One hand' },
        { value: '100', label: '100 points' },
        { value: '250', label: '250 points' },
        { value: '500', label: '500 points' },
      ],
    },
    { key: 'handSize', label: 'Starting hand', type: 'number', min: 3, max: 10, default: 7, suffix: ' cards' },
    { key: 'turnTime', label: 'Turn time', type: 'number', min: 0, max: 120, step: 5, default: 30, suffix: 's', help: '0 = no limit. Running out of time draws a card for you.' },
    { key: 'stacking', label: 'Stack +2 / +4', type: 'toggle', default: false, help: 'Pass a draw penalty on by playing another +2 or +4' },
    { key: 'drawUntil', label: 'Draw until you can play', type: 'toggle', default: false },
    { key: 'strictFour', label: 'Wild +4 only without a match', type: 'toggle', default: false, help: 'Only allowed when you have no card of the current color' },
  ],
  load: () => import('./game.js'),
};
