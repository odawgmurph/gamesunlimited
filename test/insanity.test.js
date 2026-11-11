import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { convertPyxSql, cleanText } from '../scripts/build-cah-cards.mjs';
import { logic, buildDecks, RANDO } from '../src/games/insanity/logic.js';
import { parseCrCast, normalizeCode } from '../src/games/insanity/crcast.js';
import { sanitizeDecks, DEFAULT_SETS } from '../src/games/insanity/decks.js';
import { makeCtx } from './helpers.js';

const pyx = convertPyxSql(readFileSync(new URL('../data/pyx/cah_cards.sql', import.meta.url), 'utf8'));
const defaults = { decks: { sets: DEFAULT_SETS, crcast: [] }, scoreLimit: 3, handSize: 10, timer: 'normal', blanks: 0, rando: false, reboot: false };

function start(players = ['a', 'b', 'c'], over = {}, crcast = {}) {
  const ctx = makeCtx({ players: [...players], settings: { ...defaults, ...over }, assets: { pyx, crcast: (code) => crcast[code] || null } });
  const state = logic.setup(ctx);
  return { ctx, state };
}

const seat = (state, id) => state.players.find((p) => p.id === id);
const pickOf = (state, ctx) => logic.view(state, state.czar, ctx).black.pick;
const others = (state) => state.players.filter((p) => !p.bot && !p.left && p.id !== state.czar);

/** Every non-czar plays the first cards in their hand. */
function playAll(state, ctx) {
  const n = pickOf(state, ctx);
  for (const p of others(state)) {
    if (state.subs[p.id]) continue;
    const cards = p.hand.filter((r) => r[0] !== 'x').slice(0, n);
    assert.notEqual(logic.action(state, p.id, { type: 'play', cards }, ctx), false);
  }
}

// ---------------------------------------------------------------- data

test('PYX SQL converts into sets, black and white cards', () => {
  assert.ok(pyx.sets.length >= 40);
  assert.equal(pyx.sets[0].name, 'Base Game (US)');
  assert.ok(pyx.black.length > 500 && pyx.white.length > 2000);
  const base = pyx.sets.find((s) => s.id === 2);
  assert.equal(base.b.length, 100);
  assert.equal(base.w.length, 500);
  assert.ok(pyx.black.every(([t, pick, draw]) => t && pick >= 1 && pick <= 3 && draw >= 0));
  assert.ok(pyx.black.some(([, pick, draw]) => pick === 3 && draw === 2), 'has a draw-2 pick-3 card');
  assert.ok(!pyx.white.some((t) => /&[a-z]+;|<br|<(?!\/?i>)/.test(t)), 'no stray HTML');
});

test('cleanText keeps italics and line breaks, decodes entities', () => {
  assert.equal(cleanText('Lifetime&reg; presents "____: the Story of ____."'), 'Lifetime® presents "____: the Story of ____."');
  assert.equal(cleanText('Hi<br>there <b>you</b> <i>p&lt;.05</i>'), 'Hi\nthere you <i>p<.05</i>');
  assert.equal(cleanText('&#x2605;&#x2606; Bad'), '★☆ Bad');
});

test('CrCast: CardCast-style decks parse with blanks and pick counts', () => {
  const deck = parseCrCast(
    {
      error: 0,
      name: 'Test deck',
      description: 'x',
      calls: [{ text: ['Step 1: ', '. Step 2: ', '.'] }, { text: ['What is love?', ''] }, { text: ['Just a statement.'] }],
      responses: [{ text: ['A white card.'] }, { text: ['Another'] }, { text: [''] }],
    },
    'ABC12'
  );
  assert.equal(deck.name, 'Test deck');
  assert.deepEqual(deck.black[0], ['Step 1: ____. Step 2: ____.', 2, 0]);
  assert.deepEqual(deck.black[1], ['What is love?____', 1, 0]);
  assert.equal(deck.black[2][1], 1);
  assert.deepEqual(deck.white, ['A white card.', 'Another']);
});

test('CrCast: native deck shape and errors', () => {
  const deck = parseCrCast({ deck: { name: 'N', blacks: [{ text: 'I like _ and __.' }], whites: [{ text: 'Cake' }] } }, 'ZZZZZ');
  assert.deepEqual(deck.black[0], ['I like ____ and ____.', 2, 0]);
  assert.throws(() => parseCrCast({ error: 1, message: 'Deck not found' }, 'AAAAA'), /Deck not found/);
  assert.throws(() => parseCrCast({ calls: [], responses: [] }, 'AAAAA'), /no cards/);
});

test('deck codes: bare codes and links', () => {
  assert.equal(normalizeCode(' ab1cd '), 'AB1CD');
  assert.equal(normalizeCode('https://crcast.cc/view?id=4XK2P'), '4XK2P');
  assert.equal(normalizeCode('https://api.crcast.cc/v1/cc/decks/4XK2P/all'), '4XK2P');
  assert.equal(normalizeCode('nope'), null);
  assert.equal(normalizeCode('TOOLONG1'), null);
});

test('deck settings are sanitized', () => {
  const v = sanitizeDecks({ sets: [2, '235', -1, 'x', 2], crcast: [{ code: 'ab1cd', name: 'A', b: 3, w: '9' }, { code: 'AB1CD' }, { code: 'bad' }] });
  assert.deepEqual(v, { sets: [2, 235], crcast: [{ code: 'AB1CD', name: 'A', b: 3, w: 9 }] });
  assert.deepEqual(sanitizeDecks(null), { sets: [], crcast: [] });
});

test('buildDecks dedupes shared base-game cards and adds imported decks', () => {
  const us = buildDecks({ decks: { sets: [2], crcast: [] } }, { pyx });
  const both = buildDecks({ decks: { sets: [2, 103], crcast: [] } }, { pyx });
  assert.ok(both.whites.length < us.whites.length * 1.5, 'Canada mostly overlaps US');
  const deck = { black: [['Custom ____.', 1, 0]], white: ['Custom white.'] };
  const withCustom = buildDecks({ decks: { sets: [2], crcast: [{ code: 'AAAAA' }, { code: 'BBBBB' }] } }, { pyx, crcast: (c) => (c === 'AAAAA' ? deck : null) });
  assert.equal(withCustom.whites.length, us.whites.length + 1);
  assert.deepEqual(withCustom.cw, ['Custom white.']);
  assert.deepEqual(withCustom.missing, ['BBBBB']);
});

// ---------------------------------------------------------------- setup

test('setup deals hands, picks a czar and a black card', () => {
  const { state, ctx } = start();
  assert.equal(state.phase, 'play');
  assert.equal(state.round, 1);
  assert.ok(['a', 'b', 'c'].includes(state.czar));
  const draw = logic.view(state, 'a', ctx).black.draw;
  for (const p of state.players) assert.equal(p.hand.length, 10 + (p.id === state.czar ? 0 : draw));
});

test('setup refuses missing CrCast decks, empty decks and tiny decks', () => {
  assert.throws(() => start(['a', 'b', 'c'], { decks: { sets: [2], crcast: [{ code: 'NOPE1' }] } }), /Still loading CrCast deck NOPE1/);
  assert.throws(() => start(['a', 'b', 'c'], { decks: { sets: [2374], crcast: [] } }), /no black cards/);
  assert.throws(() => start(['a', 'b', 'c'], { decks: { sets: [398], crcast: [] } }), /Not enough white cards/);
  const deck = { black: [['A ____.', 1, 0]], white: Array.from({ length: 60 }, (_, i) => `W${i}`) };
  const { state } = start(['a', 'b', 'c'], { decks: { sets: [], crcast: [{ code: 'CUSTM' }] } }, { CUSTM: deck });
  assert.equal(state.phase, 'play');
  assert.match(state.players[0].hand[0], /^c\d+$/);
});

// ---------------------------------------------------------------- rounds

test('a full round: play, judge anonymously, score, rotate czar', () => {
  const { state, ctx } = start(['a', 'b', 'c', 'd']);
  const czar = state.czar;
  assert.equal(logic.action(state, czar, { type: 'play', cards: [seat(state, czar).hand[0]] }, ctx), false, 'czar cannot play');
  playAll(state, ctx);
  assert.equal(state.phase, 'judge');

  const watcher = others(state)[0].id;
  const v = logic.view(state, watcher, ctx);
  assert.equal(v.table.length, 3);
  assert.ok(v.table.every((g) => g.who === undefined && g.name === undefined), 'authors hidden while judging');
  assert.equal(v.table.filter((g) => g.mine).length, 1);
  assert.equal(logic.view(state, czar, ctx).table.filter((g) => g.mine).length, 0);

  assert.equal(logic.action(state, watcher, { type: 'judge', index: 0 }, ctx), false, 'only the czar judges');
  const winner = state.order[1];
  logic.action(state, czar, { type: 'judge', index: 1 }, ctx);
  assert.equal(state.phase, 'result');
  assert.equal(seat(state, winner).score, 1);
  const rv = logic.view(state, 'a', ctx);
  assert.equal(rv.result.winner, winner);
  assert.equal(rv.table[1].who, winner, 'authors revealed afterwards');
  assert.equal(state.history.length, 1);

  ctx.now = state.deadline;
  logic.tick(state, ctx);
  assert.equal(state.phase, 'play');
  assert.equal(state.round, 2);
  assert.notEqual(state.czar, czar);
  for (const p of state.players) assert.ok(p.hand.length >= 10, 'hands refilled');
});

test('plays must match the pick count and come from your hand', () => {
  const { state, ctx } = start();
  const p = others(state)[0];
  const n = pickOf(state, ctx);
  assert.equal(logic.action(state, p.id, { type: 'play', cards: p.hand.slice(0, n + 1) }, ctx), false);
  assert.equal(logic.action(state, p.id, { type: 'play', cards: ['p999999'].concat(p.hand.slice(0, n - 1)) }, ctx), false);
  assert.equal(logic.action(state, p.id, { type: 'play', cards: Array(n).fill(p.hand[0]) }, ctx), n === 1 ? undefined : false);
});

test('pick-2 cards need two cards, kept in order', () => {
  const { state, ctx } = start();
  const twoIdx = pyx.black.findIndex(([, pick, draw]) => pick === 2 && draw === 0);
  state.black = 'p' + twoIdx;
  const p = others(state)[0];
  const [x, y] = p.hand;
  assert.equal(logic.action(state, p.id, { type: 'play', cards: [x] }, ctx), false);
  logic.action(state, p.id, { type: 'play', cards: [y, x] }, ctx);
  assert.deepEqual(state.subs[p.id].map((c) => c.r), [y, x]);
});

test('blank cards need written text, which is shown to the czar', () => {
  const { state, ctx } = start(['a', 'b', 'c'], { blanks: 5 });
  state.black = 'p' + pyx.black.findIndex(([, pick]) => pick === 1);
  const [p, q] = others(state);
  p.hand[0] = 'x0';
  assert.equal(logic.action(state, p.id, { type: 'play', cards: ['x0'] }, ctx), false);
  assert.equal(logic.action(state, p.id, { type: 'play', cards: ['x0'], texts: { x0: '   ' } }, ctx), false);
  logic.action(state, p.id, { type: 'play', cards: ['x0'], texts: { x0: '  My <b>own</b>  answer ' } }, ctx);
  logic.action(state, q.id, { type: 'play', cards: [q.hand.find((r) => r[0] !== 'x')] }, ctx);
  const cards = logic.view(state, state.czar, ctx).table.flatMap((g) => g.cards);
  assert.ok(cards.includes('My b own /b answer'));
});

test('the play timer benches idle players and judging carries on', () => {
  const { state, ctx } = start(['a', 'b', 'c', 'd']);
  // Choose someone who won't be next in line to be czar.
  const ids = state.players.map((x) => x.id);
  const idle = seat(state, ids[(ids.indexOf(state.czar) + 2) % 4]);
  const [p, q] = others(state).filter((x) => x !== idle);
  for (const x of [p, q]) logic.action(state, x.id, { type: 'play', cards: x.hand.slice(0, pickOf(state, ctx)) }, ctx);
  assert.equal(state.phase, 'play');
  ctx.now = state.deadline;
  logic.tick(state, ctx);
  assert.equal(state.phase, 'judge');
  assert.equal(seat(state, idle.id).missed, 1);
  // Second miss: benched.
  logic.action(state, state.czar, { type: 'judge', index: 0 }, ctx);
  ctx.now = state.deadline;
  logic.tick(state, ctx);
  assert.notEqual(state.czar, idle.id);
  for (const x of others(state)) if (x.id !== idle.id) logic.action(state, x.id, { type: 'play', cards: x.hand.slice(0, pickOf(state, ctx)) }, ctx);
  ctx.now = state.deadline;
  logic.tick(state, ctx);
  assert.equal(seat(state, idle.id).away, true);
  assert.equal(logic.view(state, idle.id, ctx).away, true);
  logic.action(state, idle.id, { type: 'back' }, ctx);
  assert.equal(seat(state, idle.id).away, false);
});

test('nobody playing skips the round and returns no points', () => {
  const { state, ctx } = start();
  ctx.now = state.deadline;
  logic.tick(state, ctx);
  assert.equal(state.phase, 'result');
  assert.equal(state.result.skipped, true);
  assert.ok(state.players.every((p) => p.score === 0));
});

test('an idle czar skips the round and cards go back to hands', () => {
  const { state, ctx } = start();
  const n = pickOf(state, ctx);
  playAll(state, ctx);
  const p = others(state)[0];
  const before = p.hand.length;
  ctx.now = state.deadline;
  logic.tick(state, ctx);
  assert.equal(state.phase, 'result');
  assert.equal(state.result.skipped, true);
  assert.equal(p.hand.length, before + n);
});

test('disconnected players do not hold up the round', () => {
  const { state, ctx } = start(['a', 'b', 'c', 'd']);
  const [p, q, gone] = others(state);
  ctx.isConnected = (id) => id !== gone.id;
  for (const x of [p, q]) logic.action(state, x.id, { type: 'play', cards: x.hand.slice(0, pickOf(state, ctx)) }, ctx);
  assert.equal(state.phase, 'judge');
});

test('the czar leaving restarts the round; too few players waits', () => {
  const { state, ctx } = start(['a', 'b', 'c', 'd']);
  const czar = state.czar;
  logic.leave(state, czar, ctx);
  assert.equal(state.phase, 'result');
  assert.equal(state.result.reason, 'The Card Czar left');
  ctx.now = state.deadline;
  logic.tick(state, ctx);
  assert.equal(state.phase, 'play');
  assert.notEqual(state.czar, czar);
  logic.leave(state, others(state)[0].id, ctx);
  assert.equal(state.phase, 'waiting');
});

test('spectators can join mid-game and get a hand', () => {
  const { state, ctx } = start(['a', 'b', 'c']);
  logic.action(state, 'z', { type: 'join' }, ctx);
  assert.ok(ctx.players.includes('z'));
  const z = seat(state, 'z');
  assert.ok(z.hand.length >= 10);
  assert.equal(logic.view(state, 'z', ctx).canJoin, false);
  assert.equal(logic.view(state, 'y', ctx).canJoin, true);
  assert.equal(logic.view(state, 'y', ctx).hand, null);
  assert.equal(logic.action(state, 'z', { type: 'join' }, ctx), false);
});

test('waiting games restart when someone joins', () => {
  const { state, ctx } = start(['a', 'b', 'c']);
  logic.leave(state, others(state)[0].id, ctx);
  ctx.now = state.deadline || ctx.now;
  logic.tick(state, ctx);
  assert.equal(state.phase, 'waiting');
  logic.action(state, 'z', { type: 'join' }, ctx);
  assert.equal(state.phase, 'play');
});

test('Rando plays every round and never judges', () => {
  const { state, ctx } = start(['a', 'b'], { rando: true });
  assert.equal(state.phase, 'play');
  assert.ok(state.subs[RANDO]);
  assert.notEqual(state.czar, RANDO);
  const p = others(state)[0];
  logic.action(state, p.id, { type: 'play', cards: p.hand.slice(0, pickOf(state, ctx)) }, ctx);
  assert.equal(state.phase, 'judge');
  assert.equal(state.order.length, 2);
  const idx = state.order.indexOf(RANDO);
  logic.action(state, state.czar, { type: 'judge', index: idx }, ctx);
  assert.equal(seat(state, RANDO).score, 1);
  assert.equal(logic.view(state, 'a', ctx).players.find((x) => x.id === RANDO).name, 'Rando Cardrissian');
});

test('Rebooting the Universe trades a point for a new hand', () => {
  const { state, ctx } = start(['a', 'b', 'c'], { reboot: true });
  const p = others(state)[0];
  assert.equal(logic.action(state, p.id, { type: 'reboot' }, ctx), false, 'needs a point');
  p.score = 2;
  const old = [...p.hand];
  logic.action(state, p.id, { type: 'reboot' }, ctx);
  assert.equal(p.score, 1);
  assert.equal(p.hand.length, old.length);
  assert.ok(!p.hand.some((r) => old.includes(r)));
});

test('first to the score limit wins the game', () => {
  const { state, ctx } = start(['a', 'b', 'c'], { scoreLimit: 2 });
  for (let guard = 0; guard < 20 && !state.over; guard++) {
    if (state.phase === 'play') playAll(state, ctx);
    if (state.phase === 'judge') logic.action(state, state.czar, { type: 'judge', index: 0 }, ctx);
    if (state.phase === 'result') {
      ctx.now = state.deadline;
      logic.tick(state, ctx);
    }
  }
  assert.equal(state.over, true);
  assert.equal(state.phase, 'over');
  assert.ok(state.players.some((p) => p.score === 2));
  const v = logic.view(state, 'a', ctx);
  assert.ok(v.history.length >= 2);
  assert.equal(logic.action(state, 'a', { type: 'join' }, ctx), false);
});

test('views never leak other hands', () => {
  const { state, ctx } = start();
  const v = logic.view(state, 'a', ctx);
  const json = JSON.stringify(v);
  for (const p of state.players) if (p.id !== 'a') for (const r of p.hand) assert.ok(!json.includes(`"${r}"`));
});

test('state survives a JSON round trip (host migration)', () => {
  const { state, ctx } = start(['a', 'b', 'c'], { rando: true, blanks: 3 });
  playAll(state, ctx);
  const copy = JSON.parse(JSON.stringify(state));
  assert.deepEqual(copy, state);
  logic.action(copy, copy.czar, { type: 'judge', index: 0 }, ctx);
  assert.equal(copy.phase, 'result');
});
