/**
 * Short Fuse — rules. Runs only on the host. Pure functions over a plain state
 * object so it can be snapshotted for host migration and unit-tested in Node.
 */

const ALPHABETS = {
  standard: 'abcdefghijlmnopqrstuv',
  full: 'abcdefghijklmnopqrstuvwxyz',
  off: '',
};
const THRESHOLDS = { easy: 2000, medium: 500, hard: 150, brutal: 50 };

function rand(ctx, min, max) {
  return min + ctx.random() * (max - min);
}

// Prompt pools are derived from assets, so they live outside the (snapshotted) state.
const pools = new WeakMap();
function poolFor(prompts, difficulty) {
  if (!pools.has(prompts)) pools.set(prompts, {});
  const cache = pools.get(prompts);
  const min = THRESHOLDS[difficulty] ?? 500;
  cache[min] ??= Object.entries(prompts)
    .filter(([, n]) => n >= min)
    .map(([p]) => p);
  return cache[min];
}

function pickPrompt(state, ctx) {
  const pool = poolFor(ctx.assets.prompts, state.settings.difficulty);
  let p;
  for (let i = 0; i < 10; i++) {
    p = pool[Math.floor(ctx.random() * pool.length)];
    if (p !== state.prompt) break;
  }
  state.prompt = p;
  state.promptFails = 0;
}

function lightFuse(state, ctx) {
  const { fuseMin, fuseMax } = state.settings;
  const lo = Math.min(fuseMin, fuseMax);
  const hi = Math.max(fuseMin, fuseMax);
  state.fuseAt = ctx.now + rand(ctx, lo, hi) * 1000;
}

function alive(state) {
  return state.players.filter((p) => p.alive);
}

function checkOver(state, ctx) {
  const left = alive(state);
  if (left.length === 0 || (state.players.length > 1 && left.length <= 1)) {
    state.over = true;
    state.winner = left[0]?.id ?? null;
    state.endedAt = ctx.now;
    ctx.emit({ type: 'over', winner: state.winner });
    return true;
  }
  return false;
}

function nextTurn(state, ctx) {
  state.typing = '';
  if (checkOver(state, ctx)) return;
  const n = state.players.length;
  for (let i = 1; i <= n; i++) {
    const idx = (state.turn + i) % n;
    if (state.players[idx].alive) {
      state.turn = idx;
      break;
    }
  }
  state.turnStartedAt = ctx.now;
  state.turnCount++;
  // Everyone gets at least the minimum turn time.
  state.fuseAt = Math.max(state.fuseAt, ctx.now + state.settings.minTurn * 1000);
}

export const logic = {
  setup(ctx) {
    const s = ctx.settings;
    const state = {
      settings: { ...s, maxLives: Math.max(s.maxLives, s.startLives) },
      alphabet: ALPHABETS[s.bonus] ?? ALPHABETS.standard,
      players: ctx.players
        .map((id) => ({ id, lives: s.startLives, letters: '', alive: true, words: 0, longest: '' }))
        .sort(() => ctx.random() - 0.5),
      turn: 0,
      turnCount: 0,
      prompt: null,
      promptFails: 0,
      used: {},
      typing: '',
      fuseAt: 0,
      turnStartedAt: ctx.now,
      startsAt: ctx.now + 3000, // short countdown before the first turn
      last: null,
      over: false,
      winner: null,
    };
    pickPrompt(state, ctx);
    lightFuse(state, ctx);
    state.fuseAt += 3000;
    state.turnStartedAt = state.startsAt;
    return state;
  },

  action(state, pid, action, ctx) {
    if (state.over || ctx.now < state.startsAt) return false;
    const cur = state.players[state.turn];
    if (!cur || cur.id !== pid || !cur.alive) return false;

    if (action.type === 'type') {
      state.typing = String(action.text || '').slice(0, 40);
      return;
    }

    if (action.type === 'submit') {
      const word = String(action.word || '').trim().toLowerCase();
      state.typing = word;
      let reason = null;
      if (!word) return false;
      if (!word.includes(state.prompt)) reason = 'missing';
      else if (state.used[word]) reason = 'used';
      else if (!ctx.assets.dictionary.has(word)) reason = 'unknown';
      if (reason) {
        ctx.emit({ type: 'reject', who: pid, word, reason });
        return;
      }
      state.used[word] = pid;
      cur.words++;
      if (word.length > cur.longest.length) cur.longest = word;
      // Bonus letters
      let gained = false;
      if (state.alphabet) {
        for (const ch of word) if (state.alphabet.includes(ch) && !cur.letters.includes(ch)) cur.letters += ch;
        if (cur.letters.length >= state.alphabet.length) {
          cur.letters = '';
          if (cur.lives < state.settings.maxLives) {
            cur.lives++;
            gained = true;
          }
        }
      }
      state.last = { type: 'word', who: pid, word, prompt: state.prompt, at: ctx.now };
      ctx.emit({ type: 'accept', who: pid, word, gained });
      pickPrompt(state, ctx);
      nextTurn(state, ctx);
      return;
    }
    return false;
  },

  tick(state, ctx) {
    if (state.over) return false;
    const cur = state.players[state.turn];
    // Someone who dropped out only gets the minimum turn time.
    const deadline = ctx.isConnected && !ctx.isConnected(cur.id) ? Math.min(state.fuseAt, state.turnStartedAt + state.settings.minTurn * 1000) : state.fuseAt;
    if (ctx.now < deadline) return false;
    cur.lives--;
    if (cur.lives <= 0) {
      cur.lives = 0;
      cur.alive = false;
    }
    state.last = { type: 'boom', who: cur.id, prompt: state.prompt, at: ctx.now };
    ctx.emit({ type: 'boom', who: cur.id, prompt: state.prompt, dead: !cur.alive });
    state.promptFails++;
    if (state.promptFails >= state.settings.promptLife) pickPrompt(state, ctx);
    lightFuse(state, ctx);
    nextTurn(state, ctx);
  },

  leave(state, pid, ctx) {
    const p = state.players.find((x) => x.id === pid);
    if (!p || !p.alive) return false;
    p.alive = false;
    p.lives = 0;
    p.left = true;
    if (state.players[state.turn].id === pid) nextTurn(state, ctx);
    else checkOver(state, ctx);
  },

  /** What a given member sees. The fuse time stays secret. */
  view(state, viewer, ctx) {
    return {
      players: state.players.map((p) => ({
        id: p.id,
        name: ctx.name(p.id),
        lives: p.lives,
        alive: p.alive,
        letters: p.letters,
        words: p.words,
        longest: p.longest,
        left: !!p.left,
      })),
      turn: state.players[state.turn]?.id ?? null,
      turnStartedAt: state.turnStartedAt,
      startsAt: state.startsAt,
      prompt: state.prompt,
      typing: state.typing,
      alphabet: state.alphabet,
      maxLives: state.settings.maxLives,
      usedCount: Object.keys(state.used).length,
      last: state.last,
      over: state.over,
      winner: state.winner,
      you: viewer,
    };
  },
};

export const _internals = { ALPHABETS, THRESHOLDS };
