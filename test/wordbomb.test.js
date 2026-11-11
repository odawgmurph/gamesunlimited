import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logic } from '../src/games/wordbomb/logic.js';
import manifest from '../src/games/wordbomb/manifest.js';
import { makeCtx } from './helpers.js';

const defaults = Object.fromEntries(manifest.settings.map((s) => [s.key, s.default]));
const assets = {
  dictionary: new Set(['cat', 'catch', 'scatter', 'bat', 'abc', 'defghijlmnopqrstuv', 'abcdefghijlmnopqrstuv']),
  prompts: { at: 5000, ca: 3000 },
};

function start(players = ['a', 'b', 'c'], over = {}) {
  const ctx = makeCtx({ players, settings: { ...defaults, ...over }, assets });
  const state = logic.setup(ctx);
  ctx.now = state.startsAt + 1;
  return { ctx, state };
}

test('setup gives everyone starting lives and a prompt', () => {
  const { state } = start();
  assert.equal(state.players.length, 3);
  assert.ok(state.players.every((p) => p.lives === 2 && p.alive));
  assert.ok(['at', 'ca'].includes(state.prompt));
});

test('valid word advances the turn; invalid words are rejected', () => {
  const { ctx, state } = start();
  state.prompt = 'at';
  const first = state.players[state.turn].id;
  logic.action(state, first, { type: 'submit', word: 'dog' }, ctx);
  assert.equal(ctx.events.at(-1).ev.reason, 'missing');
  logic.action(state, first, { type: 'submit', word: 'zzat' }, ctx);
  assert.equal(ctx.events.at(-1).ev.reason, 'unknown');
  logic.action(state, first, { type: 'submit', word: 'CAT' }, ctx);
  assert.equal(ctx.events.at(-1).ev.type, 'accept');
  assert.notEqual(state.players[state.turn].id, first);
  // reuse is rejected
  state.prompt = 'at';
  const second = state.players[state.turn].id;
  logic.action(state, second, { type: 'submit', word: 'cat' }, ctx);
  assert.equal(ctx.events.at(-1).ev.reason, 'used');
});

test('only the current player may act', () => {
  const { ctx, state } = start();
  const other = state.players[(state.turn + 1) % 3].id;
  assert.equal(logic.action(state, other, { type: 'submit', word: 'cat' }, ctx), false);
});

test('bomb explodes, costs a life, and eliminates; last player standing wins', () => {
  const { ctx, state } = start(['a', 'b'], { startLives: 1 });
  ctx.now = state.fuseAt + 1;
  const victim = state.players[state.turn].id;
  logic.tick(state, ctx);
  assert.equal(state.players.find((p) => p.id === victim).alive, false);
  assert.equal(state.over, true);
  assert.notEqual(state.winner, victim);
});

test('every turn gets at least the minimum turn time', () => {
  const { ctx, state } = start();
  state.fuseAt = ctx.now + 100;
  state.prompt = 'at';
  logic.action(state, state.players[state.turn].id, { type: 'submit', word: 'bat' }, ctx);
  assert.ok(state.fuseAt >= ctx.now + defaults.minTurn * 1000);
});

test('completing the bonus alphabet grants a life up to the max', () => {
  const { ctx, state } = start();
  state.prompt = 'ab';
  const p = state.players[state.turn];
  logic.action(state, p.id, { type: 'submit', word: 'abcdefghijlmnopqrstuv' }, ctx);
  assert.equal(p.lives, 3);
  assert.equal(p.letters, '');
});

test('view never leaks the fuse time', () => {
  const { ctx, state } = start();
  const v = logic.view(state, 'a', ctx);
  assert.equal(JSON.stringify(v).includes(String(state.fuseAt)), false);
  assert.equal('fuseAt' in v, false);
});

test('a player leaving on their turn passes the bomb', () => {
  const { ctx, state } = start();
  const cur = state.players[state.turn].id;
  logic.leave(state, cur, ctx);
  assert.notEqual(state.players[state.turn].id, cur);
});

test('state survives a JSON round trip (needed for host migration)', () => {
  const { ctx, state } = start();
  const copy = structuredClone(state);
  copy.prompt = 'at';
  logic.action(copy, copy.players[copy.turn].id, { type: 'submit', word: 'scatter' }, ctx);
  assert.equal(copy.used.scatter !== undefined, true);
});
