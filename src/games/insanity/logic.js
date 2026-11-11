/**
 * Cards with Insanity: rules. Runs only on the host. Modelled on Pretend
 * You're Xyzzy: a rotating Card Czar reads a black card, everyone else plays
 * white cards anonymously, the Czar picks a favourite, and the first to the
 * score limit wins. Players can join mid-game, idle players are benched, and
 * the PYX extras are here: blank write-in cards, Rando Cardrissian and the
 * "Rebooting the Universe" house rule.
 *
 * State is plain JSON. Cards are referenced by short strings so the state
 * stays small enough to copy to the backup host several times a second:
 *   white: 'p12' (PYX white #12), 'c3' (state.cw[3], an imported card), 'x0' (a blank card)
 *   black: 'p40' (PYX black #40), 'c7' (state.cb[7])
 * The PYX text lives in ctx.assets.pyx (every player loads it); imported
 * CrCast cards are copied into the state at setup.
 */

export const RANDO = 'rando';
export const RANDO_NAME = 'Rando Cardrissian';
const RESULT_MS = 9000; // time to admire the winning card before the next round
const SKIP_MS = 4500;
const AWAY_AFTER = 2; // missed rounds in a row before a player is benched
const MAX_PLAYERS = 20;
const MAX_WRITE_IN = 120;
const HISTORY = 100;
export const TIMER_SCALE = { off: 0, fast: 0.6, normal: 1, slow: 2 };

function shuffle(arr, ctx) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------------------------------------------------------------- decks

/**
 * Collects the selected cards into draw piles. Duplicate texts (the regional
 * base games share most cards) are dropped.
 * @returns {{ whites: string[], blacks: string[], cw: string[], cb: any[], missing: string[] }}
 */
export function buildDecks(settings, assets) {
  const pyx = assets.pyx || { sets: [], black: [], white: [] };
  const decks = settings.decks || { sets: [], crcast: [] };
  const seenW = new Set();
  const seenB = new Set();
  const key = (t) => t.toLowerCase().replace(/<\/?i>/g, '').replace(/[^a-z0-9_]+/g, ' ').trim();
  const whites = [];
  const blacks = [];
  const cw = [];
  const cb = [];
  const missing = [];
  const wanted = new Set(decks.sets);
  for (const set of pyx.sets) {
    if (!wanted.has(set.id)) continue;
    for (const i of set.w) {
      const k = key(pyx.white[i]);
      if (!seenW.has(k)) seenW.add(k), whites.push('p' + i);
    }
    for (const i of set.b) {
      const k = key(pyx.black[i][0]);
      if (!seenB.has(k)) seenB.add(k), blacks.push('p' + i);
    }
  }
  for (const { code } of decks.crcast) {
    const deck = assets.crcast?.(code);
    if (!deck) {
      missing.push(code);
      continue;
    }
    for (const t of deck.white) {
      const k = key(t);
      if (seenW.has(k)) continue;
      seenW.add(k);
      whites.push('c' + cw.length);
      cw.push(t);
    }
    for (const b of deck.black) {
      const k = key(b[0]);
      if (seenB.has(k)) continue;
      seenB.add(k);
      blacks.push('c' + cb.length);
      cb.push(b);
    }
  }
  return { whites, blacks, cw, cb, missing };
}

function blackCard(state, ref, ctx) {
  const n = Number(ref.slice(1));
  const b = ref[0] === 'p' ? ctx.assets.pyx.black[n] : state.cb[n];
  return { text: b[0], pick: b[1], draw: b[2] || 0 };
}

function whiteText(state, ref, ctx) {
  const n = Number(ref.slice(1));
  if (ref[0] === 'p') return ctx.assets.pyx.white[n];
  if (ref[0] === 'c') return state.cw[n];
  return '';
}

function drawWhite(state, ctx) {
  if (!state.wDraw.length && state.wDiscard.length) {
    state.wDraw = shuffle(state.wDiscard, ctx);
    state.wDiscard = [];
    ctx.emit({ type: 'reshuffle' });
  }
  return state.wDraw.pop() ?? null;
}

function drawBlack(state, ctx) {
  if (!state.bDraw.length && state.bDiscard.length) {
    state.bDraw = shuffle(state.bDiscard, ctx);
    state.bDiscard = [];
  }
  return state.bDraw.pop() ?? null;
}

function fillHand(state, p, size, ctx) {
  while (p.hand.length < size) {
    const c = drawWhite(state, ctx);
    if (c == null) break;
    p.hand.push(c);
  }
}

// ---------------------------------------------------------------- players

const seat = (state, id) => state.players.find((p) => p.id === id);
const isPresent = (p, ctx) => !p.left && !p.away && (p.bot || ctx.isConnected(p.id));

function canRun(state, ctx) {
  const present = state.players.filter((p) => isPresent(p, ctx));
  return present.filter((p) => !p.bot).length >= 2 && present.length >= 3;
}

/** Players still expected to play this round. */
function waitingOn(state, ctx) {
  return state.players.filter((p) => !p.bot && !p.left && !p.away && p.id !== state.czar && !state.subs[p.id] && ctx.isConnected(p.id));
}

function nextCzar(state, ctx) {
  const humans = state.players.filter((p) => !p.bot);
  const n = humans.length;
  let from = humans.findIndex((p) => p.id === state.czar);
  if (from < 0) from = state.czar == null ? Math.floor(ctx.random() * n) - 1 : -1;
  for (let k = 1; k <= n; k++) {
    const p = humans[(((from + k) % n) + n) % n];
    if (isPresent(p, ctx)) return p.id;
  }
  return null;
}

// ---------------------------------------------------------------- round flow

function timer(state, ms) {
  return state.timerScale > 0 ? Math.round(ms * state.timerScale) : 0;
}

function startRound(state, ctx) {
  state.subs = {};
  state.order = null;
  state.result = null;
  if (!canRun(state, ctx)) {
    state.phase = 'waiting';
    state.black = null;
    state.deadline = 0;
    return;
  }
  const ref = drawBlack(state, ctx);
  if (ref == null) {
    // Only possible with a tiny deck: end the game rather than stall.
    state.phase = 'over';
    state.over = true;
    state.deadline = 0;
    return;
  }
  state.czar = nextCzar(state, ctx);
  state.black = ref;
  state.round++;
  const b = blackCard(state, ref, ctx);
  for (const p of state.players) {
    if (p.bot || p.left) continue;
    fillHand(state, p, state.handSize + (p.id === state.czar ? 0 : b.draw), ctx);
  }
  const rando = seat(state, RANDO);
  if (rando && !rando.left) {
    const cards = [];
    for (let k = 0; k < b.pick; k++) {
      let c = drawWhite(state, ctx);
      // Rando doesn't write on blank cards; put them back and take another.
      for (let tries = 0; c && c[0] === 'x' && tries < 5; tries++) {
        state.wDraw.unshift(c);
        c = drawWhite(state, ctx);
      }
      if (c) cards.push({ r: c });
    }
    if (cards.length === b.pick) state.subs[RANDO] = cards;
  }
  state.phase = 'play';
  state.startedAt = ctx.now;
  const ms = timer(state, 45000 + 15000 * (b.pick - 1) + 10000 * b.draw);
  state.deadline = ms && ctx.now + ms;
  ctx.emit({ type: 'round', czar: state.czar, round: state.round });
}

function startJudging(state, ctx) {
  state.order = shuffle(Object.keys(state.subs), ctx);
  state.phase = 'judge';
  state.startedAt = ctx.now;
  const ms = timer(state, 25000 + 6000 * state.order.length);
  state.deadline = ms && ctx.now + ms;
  ctx.emit({ type: 'judge' });
}

/** Throws the played cards away (or back into hands) and moves on. */
function clearTable(state, returnCards) {
  for (const [pid, cards] of Object.entries(state.subs)) {
    const p = seat(state, pid);
    for (const c of cards) {
      if (returnCards && p && !p.bot && !p.left) p.hand.push(c.r);
      else state.wDiscard.push(c.r);
    }
  }
  if (state.black) state.bDiscard.push(state.black);
}

function skipRound(state, ctx, reason) {
  const b = state.black;
  clearTable(state, true);
  state.subs = {};
  state.order = null;
  state.result = { skipped: true, reason, black: b };
  state.phase = 'result';
  state.startedAt = ctx.now;
  state.deadline = ctx.now + SKIP_MS;
  ctx.emit({ type: 'skip', reason });
}

function declareWinner(state, idx, ctx) {
  const sid = state.order[idx];
  const winner = seat(state, sid);
  winner.score++;
  const b = blackCard(state, state.black, ctx);
  const answers = state.subs[sid].map((c) => c.t ?? whiteText(state, c.r, ctx));
  state.history.push({ round: state.round, black: b.text, answers, who: sid });
  if (state.history.length > HISTORY) state.history.shift();
  // Keep the table on display, with names, until the next round.
  state.result = {
    winner: sid,
    index: idx,
    black: state.black,
    shown: state.order.map((pid) => ({ pid, cards: state.subs[pid].map((c) => c.t ?? whiteText(state, c.r, ctx)) })),
  };
  clearTable(state, false);
  state.subs = {};
  state.startedAt = ctx.now;
  ctx.emit({ type: 'win', who: sid, round: state.round });
  if (winner.score >= state.scoreLimit) {
    state.phase = 'over';
    state.over = true;
    state.deadline = 0;
    ctx.emit({ type: 'over', who: sid });
  } else {
    state.phase = 'result';
    state.deadline = ctx.now + RESULT_MS;
  }
}

/** Moves the game along after anything changes. */
function advance(state, ctx) {
  if (state.over) return;
  if (state.phase === 'waiting') {
    if (canRun(state, ctx)) startRound(state, ctx);
    return;
  }
  if (state.phase === 'play' || state.phase === 'judge') {
    const czar = seat(state, state.czar);
    if (!czar || czar.left) return skipRound(state, ctx, 'The Card Czar left');
    if (!canRun(state, ctx) && state.phase === 'play') {
      clearTable(state, true);
      state.subs = {};
      state.black = null;
      state.phase = 'waiting';
      state.deadline = 0;
      return;
    }
  }
  if (state.phase === 'play' && waitingOn(state, ctx).length === 0 && Object.keys(state.subs).some((id) => id !== RANDO)) {
    startJudging(state, ctx);
  }
}

// ---------------------------------------------------------------- the API

export const logic = {
  setup(ctx) {
    const s = ctx.settings;
    const { whites, blacks, cw, cb, missing } = buildDecks(s, ctx.assets);
    if (missing.length) {
      throw new Error(`Still loading CrCast deck${missing.length > 1 ? 's' : ''} ${missing.join(', ')}. Try again in a moment, or remove ${missing.length > 1 ? 'them' : 'it'}.`);
    }
    if (!blacks.length) throw new Error('The chosen decks have no black cards. Add another deck.');
    if (ctx.players.length + (s.rando ? 1 : 0) < 3) throw new Error('Needs 3 players, or 2 with Rando Cardrissian.');
    const blanks = Array.from({ length: s.blanks || 0 }, (_, i) => 'x' + i);
    const needed = ctx.players.length * (s.handSize + 2) + 10;
    if (whites.length + blanks.length < needed) {
      throw new Error(`Not enough white cards (${whites.length + blanks.length}) for ${ctx.players.length} players. Add more decks.`);
    }
    const state = {
      phase: 'play',
      over: false,
      round: 0,
      scoreLimit: s.scoreLimit,
      handSize: s.handSize,
      timerScale: TIMER_SCALE[s.timer] ?? 1,
      reboot: !!s.reboot,
      players: ctx.players.map((id) => ({ id, score: 0, hand: [], missed: 0, away: false, left: false })),
      czar: null,
      black: null,
      subs: {},
      order: null,
      result: null,
      deadline: 0,
      startedAt: ctx.now,
      wDraw: shuffle([...whites, ...blanks], ctx),
      wDiscard: [],
      bDraw: shuffle(blacks, ctx),
      bDiscard: [],
      cw,
      cb,
      history: [],
    };
    if (s.rando) state.players.push({ id: RANDO, bot: true, score: 0, hand: [], missed: 0, away: false, left: false });
    for (const p of state.players) if (!p.bot) fillHand(state, p, state.handSize, ctx);
    startRound(state, ctx);
    return state;
  },

  action(state, pid, a, ctx) {
    if (state.over || !a || typeof a !== 'object') return false;
    const p = seat(state, pid);

    if (a.type === 'join') {
      if (p && !p.left) return false;
      if (state.players.filter((x) => !x.bot && !x.left).length >= MAX_PLAYERS) return false;
      ctx.addPlayer(pid);
      if (p) Object.assign(p, { left: false, away: false, missed: 0, hand: [] });
      const me = p || { id: pid, score: 0, hand: [], missed: 0, away: false, left: false };
      if (!p) {
        const bot = state.players.findIndex((x) => x.bot);
        state.players.splice(bot < 0 ? state.players.length : bot, 0, me); // keep Rando last
      }
      const b = state.black && state.phase === 'play' ? blackCard(state, state.black, ctx) : null;
      fillHand(state, me, state.handSize + (b ? b.draw : 0), ctx);
      ctx.emit({ type: 'joined', who: pid });
      advance(state, ctx);
      return;
    }

    if (!p || p.left || p.bot) return false;

    if (a.type === 'back') {
      if (!p.away) return false;
      p.away = false;
      p.missed = 0;
      advance(state, ctx);
      return;
    }

    if (a.type === 'play') {
      if (state.phase !== 'play' || pid === state.czar || state.subs[pid]) return false;
      const b = blackCard(state, state.black, ctx);
      const refs = Array.isArray(a.cards) ? a.cards.map(String) : [];
      if (refs.length !== b.pick || new Set(refs).size !== refs.length) return false;
      if (!refs.every((r) => p.hand.includes(r))) return false;
      const cards = [];
      for (const r of refs) {
        if (r[0] === 'x') {
          const t = String(a.texts?.[r] ?? '')
            // eslint-disable-next-line no-control-regex
            .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, MAX_WRITE_IN);
          if (!t) return false;
          cards.push({ r, t });
        } else cards.push({ r });
      }
      p.hand = p.hand.filter((r) => !refs.includes(r));
      state.subs[pid] = cards;
      p.missed = 0;
      p.away = false;
      ctx.emit({ type: 'played', who: pid });
      advance(state, ctx);
      return;
    }

    if (a.type === 'judge') {
      if (state.phase !== 'judge' || pid !== state.czar) return false;
      const idx = Number(a.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= state.order.length) return false;
      p.missed = 0;
      declareWinner(state, idx, ctx);
      return;
    }

    if (a.type === 'reboot') {
      if (!state.reboot || state.phase !== 'play' || pid === state.czar || state.subs[pid] || p.score < 1) return false;
      p.score--;
      state.wDiscard.push(...p.hand);
      p.hand = [];
      fillHand(state, p, state.handSize + blackCard(state, state.black, ctx).draw, ctx);
      ctx.emit({ type: 'reboot', who: pid });
      return;
    }

    return false;
  },

  tick(state, ctx) {
    if (state.over) return false;
    if (state.phase === 'waiting') {
      if (!canRun(state, ctx)) return false;
      startRound(state, ctx);
      return;
    }
    if (state.phase === 'play') {
      // Players who drop out don't hold the round up.
      if (!state.deadline || ctx.now < state.deadline) {
        const before = state.phase;
        advance(state, ctx);
        return state.phase === before ? false : undefined;
      }
      for (const p of state.players) {
        if (p.bot || p.left || p.away || p.id === state.czar || state.subs[p.id]) continue;
        if (++p.missed >= AWAY_AFTER) {
          p.away = true;
          ctx.emit({ type: 'away', who: p.id });
        }
      }
      if (Object.keys(state.subs).some((id) => id !== RANDO)) startJudging(state, ctx);
      else skipRound(state, ctx, 'Nobody played a card');
      return;
    }
    if (state.phase === 'judge') {
      if (!state.deadline || ctx.now < state.deadline) return false;
      const czar = seat(state, state.czar);
      if (czar && ++czar.missed >= AWAY_AFTER) {
        czar.away = true;
        ctx.emit({ type: 'away', who: czar.id });
      }
      skipRound(state, ctx, 'The Card Czar didn’t pick a winner');
      return;
    }
    if (state.phase === 'result') {
      if (ctx.now < state.deadline) return false;
      startRound(state, ctx);
      return;
    }
    return false;
  },

  leave(state, pid, ctx) {
    const p = seat(state, pid);
    if (!p || p.left) return false;
    p.left = true;
    state.wDiscard.push(...p.hand);
    p.hand = [];
    if (state.phase === 'play' && state.subs[pid]) {
      state.wDiscard.push(...state.subs[pid].map((c) => c.r));
      delete state.subs[pid];
    }
    advance(state, ctx);
  },

  view(state, viewer, ctx) {
    const me = seat(state, viewer);
    const playing = !!me && !me.left;
    const b = state.black ? blackCard(state, state.black, ctx) : null;
    const resultBlack = state.result?.black ? blackCard(state, state.result.black, ctx) : null;
    const nameOf = (id) => (id === RANDO ? RANDO_NAME : ctx.name(id));
    const reveal = state.phase === 'result' || state.phase === 'over';

    let table = null;
    if (state.phase === 'judge') {
      table = state.order.map((pid, i) => ({
        i,
        cards: state.subs[pid].map((c) => c.t ?? whiteText(state, c.r, ctx)),
        mine: pid === viewer,
      }));
    } else if (reveal && state.result?.shown) {
      table = state.result.shown.map((s, i) => ({ i, cards: s.cards, who: s.pid, name: nameOf(s.pid), mine: s.pid === viewer }));
    }

    const mySub = playing && state.subs[viewer] ? state.subs[viewer].map((c) => c.t ?? whiteText(state, c.r, ctx)) : null;
    return {
      phase: state.phase,
      over: state.over,
      round: state.round,
      scoreLimit: state.scoreLimit,
      deadline: state.deadline,
      startedAt: state.startedAt,
      czar: state.czar,
      black: reveal ? resultBlack : b,
      players: state.players.map((p) => ({
        id: p.id,
        name: nameOf(p.id),
        score: p.score,
        bot: !!p.bot,
        left: p.left,
        away: p.away,
        connected: p.bot || ctx.isConnected(p.id),
        played: state.phase === 'play' && !!state.subs[p.id],
      })),
      you: playing ? viewer : null,
      away: playing ? me.away : false,
      canJoin: !playing && !state.over,
      hand: playing ? me.hand.map((r) => ({ r, text: whiteText(state, r, ctx), blank: r[0] === 'x' })) : null,
      played: mySub,
      submitted: Object.keys(state.subs).length,
      waitingOn: state.phase === 'play' ? waitingOn(state, ctx).map((p) => p.id) : [],
      table,
      result: state.result ? { winner: state.result.winner ?? null, index: state.result.index ?? null, skipped: !!state.result.skipped, reason: state.result.reason || null } : null,
      canReboot: state.reboot && playing && state.phase === 'play' && viewer !== state.czar && !state.subs[viewer] && me.score >= 1,
      reboot: state.reboot,
      history: state.over ? state.history : null,
      decks: { white: state.wDraw.length, black: state.bDraw.length },
    };
  },
};
