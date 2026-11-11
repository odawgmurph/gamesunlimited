# Adding a game

A game is a folder in `src/games/<id>/` with three parts, plus one line in
`src/games/index.js`. You never touch networking, lobbies, hosting or
migration — the framework handles all of it.

```
src/games/coinflip/
  manifest.js   name, player counts, settings, rules (loaded up front, tiny)
  game.js       exports { logic, View, prepare? } (loaded when the game is picked)
  logic.js      the rules — runs only on the host
  View.jsx      what players see — runs on everyone
```

## How it fits together

```
 player clicks ──► api.act({type:'guess', side:'heads'})
                         │  (sent to whoever is hosting)
                         ▼
          logic.action(state, playerId, action, ctx)   ← host only, mutates state
                         │
                         ▼
          logic.view(state, viewerId, ctx)  ← called once per player
                         │  (each player gets only their own view)
                         ▼
                 <View view={...} />        ← re-renders on every player
```

* **State is a plain JSON object.** No classes, functions, Sets or Maps — it is
  copied to a backup player so the game can survive the host leaving.
* **`view()` is your anti-cheat.** Only what it returns ever reaches a player's
  browser (except the host and their backup, who necessarily hold everything).
* **Timers are deadlines in state** (`state.endsAt = ctx.now + 30000`), checked in
  `tick()`. Never use `setTimeout` in logic — it would be lost on host migration.
* **Randomness:** use `ctx.random()`; **time:** use `ctx.now`.

## 1. `manifest.js`

```js
export default {
  id: 'coinflip',
  name: 'Coin Flip',
  icon: '🪙',
  color: '#f5c542',
  tagline: 'Call it in the air.',
  minPlayers: 1,
  maxPlayers: 12,
  rules: ['Everyone guesses heads or tails.', 'Right guesses score a point.'],
  settings: [
    { key: 'rounds', label: 'Rounds', type: 'number', min: 1, max: 20, default: 5 },
    { key: 'guessTime', label: 'Time to guess', type: 'number', min: 3, max: 30, default: 8, suffix: 's' },
  ],
  load: () => import('./game.js'),
};
```

Setting types: `number`, `toggle`, `select` (with `options`). The lobby renders
and validates them for you; your logic receives them as `ctx.settings`.

## 2. `logic.js`

```js
export const logic = {
  setup(ctx) {
    return {
      round: 1,
      endsAt: ctx.now + ctx.settings.guessTime * 1000,
      guesses: {},
      scores: Object.fromEntries(ctx.players.map((id) => [id, 0])),
      last: null,
      over: false, // the framework shows "Play again / Back to lobby" when true
    };
  },

  action(state, pid, a, ctx) {
    if (state.over || a.type !== 'guess' || !(pid in state.scores)) return false;
    if (a.side !== 'heads' && a.side !== 'tails') return false;
    state.guesses[pid] = a.side;
  },

  tick(state, ctx) {
    if (state.over || ctx.now < state.endsAt) return false; // false = nothing changed
    const side = ctx.random() < 0.5 ? 'heads' : 'tails';
    for (const [pid, g] of Object.entries(state.guesses)) if (g === side) state.scores[pid]++;
    ctx.emit({ type: 'flip', side }); // one-off event for sounds/animations
    state.last = side;
    state.guesses = {};
    if (state.round >= ctx.settings.rounds) state.over = true;
    else {
      state.round++;
      state.endsAt = ctx.now + ctx.settings.guessTime * 1000;
    }
  },

  leave(state, pid) {
    delete state.guesses[pid];
  },

  view(state, viewer, ctx) {
    return {
      round: state.round,
      endsAt: state.endsAt,
      last: state.last,
      over: state.over,
      myGuess: state.guesses[viewer] ?? null, // others' guesses stay hidden
      guessed: Object.keys(state.guesses).length,
      scores: Object.entries(state.scores).map(([id, s]) => ({ id, name: ctx.name(id), score: s })),
    };
  },
};
```

## 3. `View.jsx` and `game.js`

```jsx
// View.jsx
import { useEffect } from 'preact/hooks';
import { sfx } from '../../ui/sfx.js';

export function View({ view, api }) {
  useEffect(() => api.onEvent((ev) => ev.type === 'flip' && sfx.good()), [api]);
  const secs = Math.max(0, Math.ceil((view.endsAt - api.now()) / 1000));
  return (
    <div class="card">
      <h2>Round {view.round} {view.last && `— last flip: ${view.last}`}</h2>
      {!view.over && (
        <p>
          {secs}s left ·{' '}
          <button class="btn" onClick={() => api.act({ type: 'guess', side: 'heads' })}>Heads</button>{' '}
          <button class="btn" onClick={() => api.act({ type: 'guess', side: 'tails' })}>Tails</button>{' '}
          {view.myGuess && <span class="muted">You picked {view.myGuess}</span>}
        </p>
      )}
      <ul>{view.scores.map((s) => <li key={s.id}>{s.name}: {s.score}</li>)}</ul>
    </div>
  );
}
```

```js
// game.js
export { logic } from './logic.js';
export { View } from './View.jsx';
// Optional: load big assets (word lists, images). Runs on every player,
// because anyone might become host. The result arrives as ctx.assets.
// export async function prepare() { return { words: await (await fetch('/games/coinflip/x.json')).json() }; }
```

The view only re-renders when the state changes, so for a ticking countdown add
a small interval in the component (see `useNow` in `wordbomb/View.jsx`).

## 4. Register it

```js
// src/games/index.js
import coinflip from './coinflip/manifest.js';
export const GAMES = [wordbomb, mafia, coinflip];
```

That's it: it shows up in the lobby, gets settings, and supports host
migration and spectators for free.

## Testing

Rules are plain functions, so test them in Node without a browser — see
`test/wordbomb.test.js` and `test/helpers.js` (`makeCtx`). To try multiplayer
locally without any server, open several tabs at `http://localhost:5173/?net=local`.

## Optional extras

* `roomChatDuringGame: false` in the manifest hides the room chat while the game
  runs (use it if the game has its own channels, like Mafia).
* `ctx.isConnected(id)` lets rules skip or shorten turns for disconnected players.
* `ctx.emit(event, toIds)` sends a one-off event to some players only.
