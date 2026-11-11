import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logic, buildRoles, channelsFor } from '../src/games/mafia/logic.js';
import manifest from '../src/games/mafia/manifest.js';
import { makeCtx } from './helpers.js';

const defaults = Object.fromEntries(manifest.settings.map((s) => [s.key, s.default]));

function setup(roles, over = {}) {
  const players = roles.map((_, i) => `p${i}`);
  const ctx = makeCtx({ players, settings: { ...defaults, ...over } });
  const state = logic.setup(ctx);
  state.players.forEach((p, i) => {
    p.role = roles[i];
    p.bullets = roles[i] === 'vigilante' ? 1 : 0;
  });
  return { ctx, state, ids: players };
}

function advance(state, ctx) {
  ctx.now = state.phaseEndsAt + 1;
  logic.tick(state, ctx);
}

test('role builder keeps mafia a minority and fills specials', () => {
  for (let n = 3; n <= 20; n++) {
    const r = buildRoles(n, { ...defaults, jester: true, vigilante: true });
    const mafia = r.filter((x) => x === 'mafioso' || x === 'godfather').length;
    assert.equal(r.length, n);
    assert.ok(mafia >= 1 && mafia < n - mafia, `n=${n} mafia=${mafia}`);
  }
  const r = buildRoles(8, defaults);
  assert.ok(r.includes('doctor') && r.includes('cop'));
});

test('night kill, doctor save, detective result', () => {
  const { ctx, state, ids } = setup(['mafioso', 'doctor', 'cop', 'villager', 'villager']);
  advance(state, ctx); // intro -> night
  assert.equal(state.phase, 'night');
  logic.action(state, 'p0', { type: 'night', target: 'p3' }, ctx);
  logic.action(state, 'p1', { type: 'night', target: 'p3' }, ctx);
  logic.action(state, 'p2', { type: 'night', target: 'p0' }, ctx);
  // all actors done -> night shortens
  assert.ok(state.phaseEndsAt <= ctx.now + 2500);
  advance(state, ctx);
  assert.equal(state.phase, 'day');
  assert.equal(state.players[3].alive, true, 'doctor saved');
  const result = state.chat.find((m) => m.to?.includes('p2'));
  assert.match(result.text, /MAFIA/);
  // others can't see the cop's result
  const v = logic.view(state, 'p3', ctx);
  assert.equal(v.chat.some((m) => m.to), false);
});

test('majority vote executes and mafia elimination ends the game', () => {
  const { ctx, state } = setup(['mafioso', 'villager', 'villager', 'villager'], { start: 'day' });
  advance(state, ctx);
  assert.equal(state.phase, 'day');
  logic.action(state, 'p1', { type: 'vote', target: 'p0' }, ctx);
  logic.action(state, 'p2', { type: 'vote', target: 'p0' }, ctx);
  assert.equal(state.phase, 'day');
  logic.action(state, 'p3', { type: 'vote', target: 'p0' }, ctx);
  assert.equal(state.over, true);
  assert.equal(state.winner, 'town');
});

test('mafia wins at parity', () => {
  const { ctx, state } = setup(['mafioso', 'villager', 'villager']);
  advance(state, ctx);
  logic.action(state, 'p0', { type: 'night', target: 'p1' }, ctx);
  advance(state, ctx);
  assert.equal(state.over, true);
  assert.equal(state.winner, 'mafia');
});

test('jester win is recorded when executed', () => {
  const { ctx, state } = setup(['mafioso', 'jester', 'villager', 'villager', 'villager'], { start: 'day' });
  advance(state, ctx);
  for (const v of ['p0', 'p2', 'p3']) logic.action(state, v, { type: 'vote', target: 'p1' }, ctx);
  assert.deepEqual(state.jesterWinners, ['p1']);
  assert.equal(state.over, false);
});

test('roles are hidden from town but visible to mafia teammates', () => {
  const { ctx, state } = setup(['mafioso', 'godfather', 'villager', 'villager', 'villager', 'cop']);
  const town = logic.view(state, 'p2', ctx);
  assert.equal(town.players.filter((p) => p.role).length, 1);
  const maf = logic.view(state, 'p0', ctx);
  assert.equal(maf.players.filter((p) => p.role).length, 2);
});

test('chat channels follow phase and life', () => {
  const { ctx, state } = setup(['mafioso', 'villager', 'villager', 'villager']);
  advance(state, ctx);
  assert.deepEqual(channelsFor(state, 'p1').write, []);
  assert.deepEqual(channelsFor(state, 'p0').write, ['mafia']);
  assert.equal(logic.action(state, 'p1', { type: 'chat', ch: 'town', text: 'hi' }, ctx), false);
  state.players[1].alive = false;
  assert.deepEqual(channelsFor(state, 'p1').write, ['dead']);
  assert.ok(channelsFor(state, 'spectator').read.includes('dead'));
});

test('godfather appears innocent and picks the kill', () => {
  const { ctx, state } = setup(['godfather', 'mafioso', 'cop', 'villager', 'villager', 'villager', 'villager']);
  advance(state, ctx);
  logic.action(state, 'p0', { type: 'night', target: 'p3' }, ctx);
  logic.action(state, 'p1', { type: 'night', target: 'p4' }, ctx);
  logic.action(state, 'p2', { type: 'night', target: 'p0' }, ctx);
  advance(state, ctx);
  assert.equal(state.players[3].alive, false);
  assert.equal(state.players[4].alive, true);
  assert.match(state.chat.find((m) => m.to?.includes('p2')).text, /not mafia/);
});
