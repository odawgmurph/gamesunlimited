import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logic, buildDeck, canPlay, cardPoints } from '../src/games/single/logic.js';
import manifest from '../src/games/single/manifest.js';
import { makeCtx } from './helpers.js';

const defaults = Object.fromEntries(manifest.settings.map((s) => [s.key, s.default]));

function start(players = ['a', 'b', 'c'], over = {}) {
  const ctx = makeCtx({ players, settings: { ...defaults, ...over } });
  const state = logic.setup(ctx);
  return { ctx, state };
}

const cur = (state) => state.players[state.turn];
const seat = (state, id) => state.players.find((p) => p.id === id);
let nextId = 1000;
const card = (c, v) => ({ id: nextId++, c, v });

/** Puts a known card on top of the pile and gives the current player a known hand. */
function rig(state, top, hand) {
  state.discard.push(top);
  state.color = top.c;
  cur(state).hand = hand;
  return cur(state);
}

test('deck has 108 cards with the right mix', () => {
  const deck = buildDeck();
  assert.equal(deck.length, 108);
  assert.equal(new Set(deck.map((c) => c.id)).size, 108);
  assert.equal(deck.filter((c) => c.c === 'w').length, 8);
  assert.equal(deck.filter((c) => c.v === '0').length, 4);
  assert.equal(deck.filter((c) => c.v === 'd2').length, 8);
  assert.equal(cardPoints({ c: 'r', v: '7' }), 7);
  assert.equal(cardPoints({ c: 'r', v: 'skip' }), 20);
  assert.equal(cardPoints({ c: 'w', v: 'w4' }), 50);
});

test('setup deals hands and starts on a number card', () => {
  const { state } = start();
  assert.ok(state.players.every((p) => p.hand.length === 7));
  assert.match(state.discard[0].v, /^\d$/);
  assert.equal(state.draw.length + state.discard.length + 21, 108);
  assert.equal(state.turn, 0);
});

test('seven or more players get a second deck', () => {
  const { state } = start(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  assert.equal(state.draw.length + state.discard.length + 7 * 7, 216);
});

test('matching by color or value; wilds go on anything', () => {
  const { state } = start();
  const p = rig(state, card('r', '5'), []);
  assert.ok(canPlay(state, p, card('r', '9')));
  assert.ok(canPlay(state, p, card('b', '5')));
  assert.ok(!canPlay(state, p, card('b', '6')));
  assert.ok(canPlay(state, p, card('w', 'wild')));
  assert.ok(canPlay(state, p, card('w', 'w4')));
});

test('only the current player may play, and only legal cards', () => {
  const { ctx, state } = start();
  const p = rig(state, card('r', '5'), [card('b', '6'), card('r', '1'), card('g', '2')]);
  const other = state.players[1];
  assert.equal(logic.action(state, other.id, { type: 'play', id: other.hand[0].id }, ctx), false);
  assert.equal(logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx), false);
  logic.action(state, p.id, { type: 'play', id: p.hand[1].id }, ctx);
  assert.equal(state.discard.at(-1).v, '1');
  assert.equal(cur(state).id, other.id);
});

test('wild needs a color and sets it', () => {
  const { ctx, state } = start();
  const wild = card('w', 'wild');
  const p = rig(state, card('r', '5'), [wild, card('g', '1')]);
  assert.equal(logic.action(state, p.id, { type: 'play', id: wild.id }, ctx), false);
  logic.action(state, p.id, { type: 'play', id: wild.id, color: 'b' }, ctx);
  assert.equal(state.color, 'b');
});

test('skip skips, reverse reverses, and reverse acts as skip with two players', () => {
  let { ctx, state } = start(['a', 'b', 'c']);
  let p = rig(state, card('r', '5'), [card('r', 'skip'), card('g', '1')]);
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.turn, 2);

  ({ ctx, state } = start(['a', 'b', 'c']));
  p = rig(state, card('r', '5'), [card('r', 'rev'), card('g', '1')]);
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.dir, -1);
  assert.equal(state.turn, 2);

  ({ ctx, state } = start(['a', 'b']));
  p = rig(state, card('r', '5'), [card('r', 'rev'), card('g', '1')]);
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(cur(state).id, p.id);
});

test('+2 makes the next player draw two and lose their turn', () => {
  const { ctx, state } = start();
  const p = rig(state, card('r', '5'), [card('r', 'd2'), card('g', '1')]);
  const victim = state.players[1];
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(victim.hand.length, 9);
  assert.equal(state.turn, 2);
  assert.equal(state.pending, 0);
});

test('stacking passes the penalty along until someone takes it', () => {
  const { ctx, state } = start(['a', 'b', 'c'], { stacking: true });
  const p = rig(state, card('r', '5'), [card('r', 'd2'), card('g', '1')]);
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.pending, 2);
  const b = cur(state);
  b.hand.push(card('w', 'w4'), card('y', '3'));
  assert.ok(!canPlay(state, b, b.hand.at(-1)), 'normal cards are blocked while a penalty is pending');
  logic.action(state, b.id, { type: 'play', id: b.hand.at(-2).id, color: 'y' }, ctx);
  assert.equal(state.pending, 6);
  const c = cur(state);
  const before = c.hand.length;
  logic.action(state, c.id, { type: 'draw' }, ctx);
  assert.equal(c.hand.length, before + 6);
  assert.equal(state.pending, 0);
  assert.equal(cur(state).id, p.id);
});

test('drawing a playable card lets you play it or pass', () => {
  const { ctx, state } = start();
  const p = rig(state, card('r', '5'), [card('b', '6'), card('g', '1')]);
  state.draw.push(card('r', '8'));
  logic.action(state, p.id, { type: 'draw' }, ctx);
  assert.equal(cur(state).id, p.id);
  assert.ok(state.drawnId != null);
  // can't play a different card now
  assert.equal(logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx), false);
  logic.action(state, p.id, { type: 'pass' }, ctx);
  assert.notEqual(cur(state).id, p.id);
  assert.equal(p.hand.length, 3);
});

test('drawing an unplayable card ends your turn', () => {
  const { ctx, state } = start();
  const p = rig(state, card('r', '5'), [card('b', '6'), card('g', '1')]);
  state.draw.push(card('y', '8'));
  logic.action(state, p.id, { type: 'draw' }, ctx);
  assert.notEqual(cur(state).id, p.id);
});

test('draw until playable keeps drawing', () => {
  const { ctx, state } = start(['a', 'b'], { drawUntil: true });
  const p = rig(state, card('r', '5'), [card('b', '6'), card('g', '1')]);
  state.draw.push(card('r', '9'), card('y', '8'), card('y', '7'));
  logic.action(state, p.id, { type: 'draw' }, ctx);
  assert.equal(p.hand.length, 5);
  assert.equal(p.hand.find((c) => c.id === state.drawnId).v, '9');
});

test('empty draw pile reshuffles the discards', () => {
  const { ctx, state } = start(['a', 'b']);
  const p = rig(state, card('r', '5'), [card('b', '6')]);
  state.discard.unshift(card('y', '1'), card('y', '2'));
  state.draw = [];
  logic.action(state, p.id, { type: 'draw' }, ctx);
  assert.equal(p.hand.length, 2);
  assert.equal(state.discard.length, 1);
  assert.equal(state.discard[0].v, '5');
});

test('forgetting to call Single gets you caught; calling protects you', () => {
  let { ctx, state } = start();
  let p = rig(state, card('r', '5'), [card('r', '1'), card('g', '1')]);
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.vulnerable, p.id);
  logic.action(state, 'c', { type: 'catch' }, ctx);
  assert.equal(p.hand.length, 3);
  assert.equal(state.vulnerable, null);

  ({ ctx, state } = start());
  p = rig(state, card('r', '5'), [card('r', '1'), card('g', '1')]);
  logic.action(state, p.id, { type: 'single' }, ctx);
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.vulnerable, null);
  assert.equal(logic.action(state, 'c', { type: 'catch' }, ctx), false);
});

test('the catch window closes once the next player acts', () => {
  const { ctx, state } = start();
  const p = rig(state, card('r', '5'), [card('r', '1'), card('g', '1')]);
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  logic.action(state, cur(state).id, { type: 'draw' }, ctx);
  assert.equal(state.vulnerable, null);
});

test('one-hand game: emptying your hand wins and scores the others', () => {
  const { ctx, state } = start(['a', 'b']);
  const p = rig(state, card('r', '5'), [card('r', '1')]);
  state.players[1].hand = [card('w', 'wild'), card('b', '7'), card('g', 'skip')];
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.over, true);
  assert.equal(state.winner, p.id);
  assert.equal(p.score, 77);
});

test('points game: rounds continue until someone reaches the target', () => {
  const { ctx, state } = start(['a', 'b'], { target: '100' });
  const p = rig(state, card('r', '5'), [card('r', '1')]);
  state.players[1].hand = [card('b', '7')];
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.over, false);
  assert.equal(state.phase, 'roundEnd');
  ctx.now = state.nextRoundAt;
  logic.tick(state, ctx);
  assert.equal(state.phase, 'play');
  assert.equal(state.round, 2);
  assert.ok(state.players.every((x) => x.hand.length === 7));
  assert.equal(seat(state, p.id).score, 7);
});

test('a final +2 still makes the next player draw before scoring', () => {
  const { ctx, state } = start(['a', 'b']);
  const p = rig(state, card('r', '5'), [card('r', 'd2')]);
  state.players[1].hand = [];
  state.draw.push(card('b', '3'), card('b', '4'));
  logic.action(state, p.id, { type: 'play', id: p.hand[0].id }, ctx);
  assert.equal(state.winner, p.id);
  assert.equal(p.score, 7);
});

test('running out of time draws for you and passes', () => {
  const { ctx, state } = start();
  const p = rig(state, card('r', '5'), [card('b', '6')]);
  state.draw.push(card('r', '9'));
  ctx.now = state.turnEndsAt;
  logic.tick(state, ctx);
  assert.equal(p.hand.length, 2);
  assert.notEqual(cur(state).id, p.id);
});

test('no turn limit still moves on for disconnected players', () => {
  const { ctx, state } = start(['a', 'b'], { turnTime: 0 });
  assert.equal(state.turnEndsAt, 0);
  ctx.now += 60000;
  assert.equal(logic.tick(state, ctx), false);
  const p = cur(state);
  ctx.isConnected = (id) => id !== p.id;
  logic.tick(state, ctx);
  assert.notEqual(cur(state).id, p.id);
});

test('leaving skips the player; the last one left wins', () => {
  const { ctx, state } = start(['a', 'b', 'c']);
  const first = cur(state).id;
  logic.leave(state, first, ctx);
  assert.notEqual(cur(state).id, first);
  assert.equal(seat(state, first).hand.length, 0);
  logic.leave(state, cur(state).id, ctx);
  assert.equal(state.over, true);
  assert.ok(state.winner);
});

test('view hides other hands and lists playable cards', () => {
  const { ctx, state } = start();
  const p = rig(state, card('r', '5'), [card('r', '1'), card('b', '9')]);
  const v = logic.view(state, p.id, ctx);
  assert.equal(v.hand.length, 2);
  assert.deepEqual(v.playable, [p.hand[0].id]);
  assert.ok(v.players.every((x) => !('hand' in x)));
  const spectator = logic.view(state, 'zzz', ctx);
  assert.equal(spectator.hand, null);
  const other = logic.view(state, state.players[1].id, ctx);
  assert.deepEqual(other.playable, []);
});
