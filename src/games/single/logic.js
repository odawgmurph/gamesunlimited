/**
 * Single — rules. Runs only on the host. A color-matching shedding card game:
 * match the top card's color or value, use action cards on your neighbours,
 * call "Single!" on your last card, and empty your hand first.
 *
 * State is plain JSON (cards are { id, c, v }) so it survives host migration.
 *   c: 'r' | 'y' | 'g' | 'b' | 'w' (wild)
 *   v: '0'–'9' | 'skip' | 'rev' | 'd2' | 'wild' | 'w4'
 */

export const COLORS = ['r', 'y', 'g', 'b'];
const ACTIONS = ['skip', 'rev', 'd2'];
const AWAY_MS = 8000; // a disconnected player's turn is played for them after this long
const DRAW_GRACE_MS = 6000; // time left to decide after drawing a playable card
const ROUND_BREAK_MS = 10000;

/** One 108-card deck: per color one 0, two of 1–9 and two of each action; 4 wilds, 4 wild +4s. */
export function buildDeck(startId = 0) {
  const deck = [];
  let id = startId;
  for (const c of COLORS) {
    deck.push({ id: id++, c, v: '0' });
    for (let n = 1; n <= 9; n++) for (let k = 0; k < 2; k++) deck.push({ id: id++, c, v: String(n) });
    for (const v of ACTIONS) for (let k = 0; k < 2; k++) deck.push({ id: id++, c, v });
  }
  for (let k = 0; k < 4; k++) deck.push({ id: id++, c: 'w', v: 'wild' });
  for (let k = 0; k < 4; k++) deck.push({ id: id++, c: 'w', v: 'w4' });
  return deck;
}

export function cardPoints(card) {
  if (card.c === 'w') return 50;
  if (ACTIONS.includes(card.v)) return 20;
  return Number(card.v);
}

const isNumber = (card) => card.c !== 'w' && /^\d$/.test(card.v);

function shuffle(arr, ctx) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function active(state) {
  return state.players.filter((p) => !p.out);
}

/** The next seat in the current direction, skipping players who left. */
function step(state, from) {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (((from + state.dir * k) % n) + n) % n;
    if (!state.players[i].out) return i;
  }
  return from;
}

/** Whether `card` from `player`'s hand may go on the pile right now. */
export function canPlay(state, player, card) {
  const top = state.discard[state.discard.length - 1];
  if (state.pending > 0) {
    // Only reachable with stacking on: answer a draw penalty with another one.
    if (card.v === 'w4') return true;
    return card.v === 'd2' && top.v === 'd2';
  }
  if (card.v === 'w4' && state.settings.strictFour) {
    return !player.hand.some((c) => c.id !== card.id && c.c === state.color);
  }
  if (card.c === 'w') return true;
  return card.c === state.color || card.v === top.v;
}

/** Draws up to n cards into a hand, reshuffling the discard pile when the deck runs out. */
function drawCards(state, player, n, ctx) {
  const got = [];
  for (let k = 0; k < n; k++) {
    if (!state.draw.length && state.discard.length > 1) {
      const top = state.discard.pop();
      state.draw = shuffle(state.discard, ctx);
      state.discard = [top];
      ctx.emit({ type: 'reshuffle' });
    }
    if (!state.draw.length) break;
    const card = state.draw.pop();
    player.hand.push(card);
    got.push(card);
  }
  if (player.hand.length > 2) player.called = false;
  if (state.vulnerable === player.id && player.hand.length !== 1) state.vulnerable = null;
  return got;
}

function startTurn(state, idx, ctx) {
  state.turn = idx;
  state.drawnId = null;
  state.turnStartedAt = ctx.now;
  state.turnEndsAt = state.settings.turnTime > 0 ? ctx.now + state.settings.turnTime * 1000 : 0;
  state.turnCount++;
}

/** Someone else acting closes the window for catching a player who forgot to call. */
function closeWindow(state, pid) {
  if (state.vulnerable && state.vulnerable !== pid) state.vulnerable = null;
}

function deal(state, ctx) {
  const seats = active(state);
  const decks = seats.length > 6 ? 2 : 1;
  const cards = [];
  for (let d = 0; d < decks; d++) cards.push(...buildDeck(d * 108));
  shuffle(cards, ctx);
  for (const p of state.players) {
    p.hand = [];
    p.called = false;
    if (!p.out) for (let k = 0; k < state.settings.handSize; k++) p.hand.push(cards.pop());
  }
  // Always start on a number card.
  let i = cards.length - 1;
  while (i > 0 && !isNumber(cards[i])) i--;
  const [first] = cards.splice(i, 1);
  state.draw = cards;
  state.discard = [first];
  state.color = first.c;
  state.dir = 1;
  state.pending = 0;
  state.vulnerable = null;
  state.phase = 'play';
  state.roundResult = null;
  state.nextRoundAt = 0;
  state.last = { type: 'deal', round: state.round };
  startTurn(state, step(state, state.dealer), ctx);
}

function endRound(state, winner, ctx) {
  const hands = state.players
    .filter((p) => !p.out)
    .map((p) => ({ id: p.id, cards: p.hand.slice(), points: p.hand.reduce((s, c) => s + cardPoints(c), 0) }));
  const points = hands.reduce((s, h) => s + h.points, 0);
  winner.score += points;
  winner.wins++;
  state.roundResult = { winner: winner.id, points, hands };
  state.vulnerable = null;
  state.drawnId = null;
  ctx.emit({ type: 'round', winner: winner.id, points });
  if (state.target === 0 || winner.score >= state.target || active(state).length < 2) {
    finish(state, winner.id, ctx);
  } else {
    state.phase = 'roundEnd';
    state.nextRoundAt = ctx.now + ROUND_BREAK_MS;
  }
}

function finish(state, winnerId, ctx) {
  state.over = true;
  state.phase = 'over';
  state.winner = winnerId;
  ctx.emit({ type: 'over', winner: winnerId });
}

function play(state, cur, card, color, ctx) {
  cur.hand.splice(cur.hand.indexOf(card), 1);
  state.discard.push(card);
  state.color = card.c === 'w' ? color : card.c;
  state.last = { type: 'play', who: cur.id, card, color: state.color };
  ctx.emit({ type: 'play', who: cur.id, card, color: state.color });
  if (cur.hand.length === 1 && !cur.called) state.vulnerable = cur.id;

  let skip = card.v === 'skip';
  if (card.v === 'rev') {
    if (active(state).length === 2) skip = true;
    else state.dir *= -1;
  }
  if (card.v === 'd2') state.pending += 2;
  if (card.v === 'w4') state.pending += 4;

  const next = step(state, state.turn);
  if (state.pending && (!state.settings.stacking || cur.hand.length === 0)) {
    const victim = state.players[next];
    const n = drawCards(state, victim, state.pending, ctx).length;
    ctx.emit({ type: 'draw', who: victim.id, n, forced: true });
    state.pending = 0;
    skip = true;
  }
  if (cur.hand.length === 0) return endRound(state, cur, ctx);
  if (skip) ctx.emit({ type: 'skipped', who: state.players[next].id });
  startTurn(state, skip ? step(state, next) : next, ctx);
}

/** Draw for your turn (or take the stacked penalty). Returns false if nothing happened. */
function takeDraw(state, cur, ctx, auto = false) {
  if (state.pending) {
    const n = drawCards(state, cur, state.pending, ctx).length;
    ctx.emit({ type: 'draw', who: cur.id, n, forced: true });
    state.pending = 0;
    state.last = { type: 'take', who: cur.id, n };
    startTurn(state, step(state, state.turn), ctx);
    return;
  }
  const drawn = [];
  do {
    const got = drawCards(state, cur, 1, ctx);
    if (!got.length) break;
    drawn.push(got[0]);
  } while (state.settings.drawUntil && !canPlay(state, cur, drawn[drawn.length - 1]));
  ctx.emit({ type: 'draw', who: cur.id, n: drawn.length });
  state.last = { type: 'draw', who: cur.id, n: drawn.length };
  const last = drawn[drawn.length - 1];
  if (!auto && last && canPlay(state, cur, last)) {
    // You may play the card you just drew, or keep it and pass.
    state.drawnId = last.id;
    if (state.turnEndsAt) state.turnEndsAt = Math.max(state.turnEndsAt, ctx.now + DRAW_GRACE_MS);
  } else {
    startTurn(state, step(state, state.turn), ctx);
  }
}

const COLOR_ORDER = { r: 0, y: 1, g: 2, b: 3, w: 4 };
const VALUE_ORDER = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'skip', 'rev', 'd2', 'wild', 'w4'];
function sortHand(hand) {
  return hand.slice().sort((a, b) => COLOR_ORDER[a.c] - COLOR_ORDER[b.c] || VALUE_ORDER.indexOf(a.v) - VALUE_ORDER.indexOf(b.v) || a.id - b.id);
}

export const logic = {
  setup(ctx) {
    const order = shuffle(ctx.players.slice(), ctx);
    const state = {
      settings: { ...ctx.settings },
      target: Number(ctx.settings.target) || 0,
      players: order.map((id) => ({ id, hand: [], score: 0, wins: 0, called: false, out: false })),
      draw: [],
      discard: [],
      color: null,
      dir: 1,
      turn: 0,
      turnCount: 0,
      turnStartedAt: ctx.now,
      turnEndsAt: 0,
      pending: 0,
      drawnId: null,
      vulnerable: null,
      phase: 'play',
      round: 1,
      dealer: order.length - 1, // so the first seat goes first
      roundResult: null,
      nextRoundAt: 0,
      last: null,
      over: false,
      winner: null,
    };
    deal(state, ctx);
    return state;
  },

  action(state, pid, a, ctx) {
    if (state.over || state.phase !== 'play' || !a) return false;
    const me = state.players.find((p) => p.id === pid);
    if (!me || me.out) return false;
    const cur = state.players[state.turn];

    // Things you can do at any time.
    if (a.type === 'single') {
      if (me.called || me.hand.length > 2) return false;
      me.called = true;
      if (state.vulnerable === pid) state.vulnerable = null;
      ctx.emit({ type: 'single', who: pid });
      return;
    }
    if (a.type === 'catch') {
      const victim = state.players.find((p) => p.id === state.vulnerable);
      if (!victim || victim.id === pid || victim.hand.length !== 1) return false;
      state.vulnerable = null;
      const n = drawCards(state, victim, 2, ctx).length;
      ctx.emit({ type: 'caught', who: victim.id, by: pid, n });
      return;
    }

    // Turn actions.
    if (cur.id !== pid) return false;
    if (a.type === 'play') {
      const card = me.hand.find((c) => c.id === a.id);
      if (!card) return false;
      if (state.drawnId != null && card.id !== state.drawnId) return false;
      if (!canPlay(state, me, card)) return false;
      if (card.c === 'w' && !COLORS.includes(a.color)) return false;
      closeWindow(state, pid);
      return play(state, me, card, a.color, ctx);
    }
    if (a.type === 'draw') {
      if (state.drawnId != null) return false;
      closeWindow(state, pid);
      return takeDraw(state, me, ctx);
    }
    if (a.type === 'pass') {
      if (state.drawnId == null) return false;
      state.last = { type: 'pass', who: pid };
      startTurn(state, step(state, state.turn), ctx);
      return;
    }
    return false;
  },

  tick(state, ctx) {
    if (state.over) return false;
    if (state.phase === 'roundEnd') {
      if (ctx.now < state.nextRoundAt) return false;
      state.round++;
      state.dealer = step(state, state.dealer);
      deal(state, ctx);
      ctx.emit({ type: 'deal', round: state.round });
      return;
    }
    const cur = state.players[state.turn];
    const limit = state.turnEndsAt || Infinity;
    const away = ctx.isConnected && !ctx.isConnected(cur.id) ? state.turnStartedAt + AWAY_MS : Infinity;
    if (ctx.now < Math.min(limit, away)) return false;
    ctx.emit({ type: 'timeout', who: cur.id });
    closeWindow(state, cur.id);
    if (state.drawnId != null) {
      state.last = { type: 'pass', who: cur.id };
      startTurn(state, step(state, state.turn), ctx);
    } else {
      takeDraw(state, cur, ctx, true);
    }
  },

  leave(state, pid, ctx) {
    const idx = state.players.findIndex((p) => p.id === pid);
    const p = state.players[idx];
    if (!p || p.out) return false;
    p.out = true;
    p.left = true;
    state.draw.unshift(...p.hand); // their cards go to the bottom of the deck
    p.hand = [];
    if (state.vulnerable === pid) state.vulnerable = null;
    const left = active(state);
    if (left.length < 2) return finish(state, left[0]?.id ?? null, ctx);
    if (state.phase === 'play' && state.turn === idx) startTurn(state, step(state, idx), ctx);
  },

  view(state, viewer, ctx) {
    const cur = state.players[state.turn];
    const me = state.players.find((p) => p.id === viewer && !p.out) || null;
    const myTurn = !!me && state.phase === 'play' && cur.id === viewer;
    return {
      players: state.players.map((p) => ({
        id: p.id,
        name: ctx.name(p.id),
        count: p.hand.length,
        score: p.score,
        wins: p.wins,
        called: p.called,
        out: p.out,
        left: !!p.left,
      })),
      you: me ? viewer : null,
      hand: me ? sortHand(me.hand) : null,
      playable: myTurn ? me.hand.filter((c) => (state.drawnId == null || c.id === state.drawnId) && canPlay(state, me, c)).map((c) => c.id) : [],
      top: state.discard[state.discard.length - 1] || null,
      discardCount: state.discard.length,
      drawCount: state.draw.length,
      color: state.color,
      dir: state.dir,
      turn: cur?.id ?? null,
      turnStartedAt: state.turnStartedAt,
      turnEndsAt: state.turnEndsAt,
      pending: state.pending,
      drawnId: myTurn ? state.drawnId : null,
      vulnerable: state.vulnerable,
      phase: state.phase,
      round: state.round,
      target: state.target,
      roundResult: state.roundResult,
      nextRoundAt: state.nextRoundAt,
      last: state.last,
      over: state.over,
      winner: state.winner,
    };
  },
};

export const _internals = { step, drawCards, deal };
