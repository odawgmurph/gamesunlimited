import { PromptEditor } from './PromptEditor.jsx';
import { sanitizeCustom } from './custom.js';

/** @type {import('../types').GameManifest} */
export default {
  id: 'quips',
  name: 'Quips',
  icon: '💬',
  color: '#2557c7',
  tagline: 'Two players, one prompt. Everyone else votes for the funnier answer.',
  minPlayers: 3,
  maxPlayers: 10,
  rules: [
    'Everyone gets two prompts and writes a short, funny answer to each. Every prompt goes to two players.',
    'Then the prompts come up one at a time with both answers, anonymously. Everyone else votes for the one they like more.',
    'Points are split by share of the vote, with a bonus for winning and a bigger one for a clean sweep. Write the same thing as your opponent and it’s a jinx: nobody scores.',
    'Round 2 is worth double (round 3 triple). In the Last Quip everyone answers the same prompt and gets three votes to spread around.',
    'Spectators can vote too. They don’t split the pot, but the crowd’s favourite earns a bonus.',
  ],
  settings: [
    { key: 'rounds', label: 'Head-to-head rounds', type: 'number', min: 1, max: 3, default: 2 },
    { key: 'final', label: 'Last Quip', type: 'toggle', default: true, help: 'A final round where everyone answers the same prompt' },
    {
      key: 'timer',
      label: 'Timer',
      type: 'select',
      default: 'normal',
      options: [
        { value: 'fast', label: 'Fast' },
        { value: 'normal', label: 'Normal' },
        { value: 'slow', label: 'Relaxed' },
        { value: 'off', label: 'No timer' },
      ],
      help: 'Normal: 90s to write, 20s to vote',
    },
    { key: 'audience', label: 'Audience votes', type: 'toggle', default: true, help: 'Spectators vote for a crowd-favourite bonus' },
    { key: 'builtIn', label: 'Built-in prompts', type: 'toggle', default: true, help: 'Nearly a thousand prompts. Turn off to play only your own.' },
    { key: 'custom', label: 'Your own prompts', type: 'custom', default: '', sanitize: sanitizeCustom, component: PromptEditor },
  ],
  load: () => import('./game.js'),
};
