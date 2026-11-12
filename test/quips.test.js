import { test } from 'node:test';
import assert from 'node:assert/strict';
import { logic, promptPool, personalize, sameAnswer, cleanAnswer, POT, WIN_BONUS, SWEEP_BONUS, CROWD_BONUS, FORFEIT, FINAL_VOTE, FINAL_VOTES } from '../src/games/quips/logic.js';
import { parsePrompts, sanitizeCustom } from '../src/games/quips/custom.js';
import { PROMPTS as BUILT_IN } from '../src/games/quips/prompts.js';
import { makeCtx } from './helpers.js';

const PROMPTS = Array.from({ length: 40 }, (_, i) => `Test prompt number ${i + 1}`);
const defaults = { rounds: 2, final: true, timer: 'normal', audience: true, custom: '' };

function start(players = ['a', 'b', 'c'], over = {}, prompts = PROMPTS) {
  const ctx = makeCtx({ players: [...players], settings: { ...defaults, ...over }, assets: { prompts } });
  const state = logic.setup(ctx);
  return { ctx, state };
}

const seat = (state, id) => state.players.find((p) => p.id === id);
const ok = (r) => assert.notEqual(r, false);

/** Everyone answers all their prompts with "<id> <prompt index>". */
function answerAll(state, ctx, text = (pid, m) => `${pid} says ${m}`) {
  state.matchups.forEach((m, i) => {
    for (const e of m.entries) if (e.text == null) ok(logic.action(state, e.pid, { type: 'answer', m: i, text: text(e.pid, i) }, ctx));
  });
}

const current = (state) => state.matchups[state.cur];
const voters = (state) => state.players.filter((p) => !p.left && !current(state).entries.some((e) => e.pid === p.id));

/** Ticks past the current deadline. */
function expire(state, ctx) {
  ctx.now = state.deadline + 1;
  logic.tick(state, ctx);
}

// ---------------------------------------------------------------- setup

test('prompts: built-in and custom are merged and de-duplicated', () => {
  assert.deepEqual(promptPool({ custom: 'One\n\n  two  \nONE\n<b>three</b>' }, ['Zero', 'one']), ['Zero', 'one', 'two', 'b three /b']);
  assert.deepEqual(parsePrompts(' a \n\nb\na'), ['a', 'b']);
  assert.equal(sanitizeCustom('x\r\ny\u0000z'), 'x\ny z');
});

test('the built-in prompts are clean', () => {
  assert.ok(BUILT_IN.length > 900);
  assert.equal(new Set(BUILT_IN.map((p) => p.toLowerCase())).size, BUILT_IN.length, 'no duplicates');
  for (const p of BUILT_IN) {
    assert.ok(p.length > 0 && p.length <= 160, p);
    assert.ok(!/[<>]|â€|Ã/.test(p), `stray markup or bad encoding: ${p}`);
  }
  assert.ok(BUILT_IN.some((p) => p.includes('____')));
  assert.ok(BUILT_IN.some((p) => p.includes('{player}')));
  assert.deepEqual(promptPool({ custom: '' }), BUILT_IN);
  assert.deepEqual(promptPool({ custom: 'Mine', builtIn: false }), ['Mine']);
});

test('{player} becomes someone who isn’t answering the prompt', () => {
  const ctx = makeCtx({ players: ['a', 'b', 'c'], settings: {} });
  for (let i = 0; i < 20; i++) assert.equal(personalize('Why {player} cries', ['a', 'b'], ['a', 'b', 'c'], ctx), 'Why name-c cries');
  assert.match(personalize('{player}!', ['a', 'b', 'c'], ['a', 'b', 'c'], ctx), /^name-[abc]!$/);
  assert.equal(personalize('No names', ['a'], ['a', 'b'], ctx), 'No names');
  const { state } = start(['a', 'b', 'c', 'd'], {}, Array.from({ length: 20 }, (_, i) => `{player} did thing ${i}`));
  for (const m of state.matchups) {
    assert.ok(!m.prompt.includes('{player}'));
    assert.ok(!m.entries.some((e) => m.prompt.startsWith(`name-${e.pid} `)));
  }
});

test('setup refuses to start without enough prompts', () => {
  assert.throws(() => start(['a', 'b', 'c'], {}, []), /no prompts/);
  // 3 players × 2 rounds + the Last Quip = 7.
  assert.throws(() => start(['a', 'b', 'c'], {}, PROMPTS.slice(0, 6)), /need 7/);
  assert.doesNotThrow(() => start(['a', 'b', 'c'], {}, PROMPTS.slice(0, 7)));
  // Custom prompts count.
  const custom = Array.from({ length: 7 }, (_, i) => `Custom ${i}`).join('\n');
  assert.doesNotThrow(() => start(['a', 'b', 'c'], { custom }, []));
});

test('every player gets two prompts and every prompt goes to two different players', () => {
  for (const n of [3, 4, 7, 10]) {
    const ids = Array.from({ length: n }, (_, i) => 'p' + i);
    const { state } = start(ids);
    assert.equal(state.phase, 'answer');
    assert.equal(state.matchups.length, n);
    const count = Object.fromEntries(ids.map((id) => [id, 0]));
    const pairs = new Set();
    for (const m of state.matchups) {
      assert.equal(m.entries.length, 2);
      assert.notEqual(m.entries[0].pid, m.entries[1].pid);
      for (const e of m.entries) count[e.pid]++;
      pairs.add([...m.entries.map((e) => e.pid)].sort().join());
    }
    assert.ok(Object.values(count).every((c) => c === 2), `n=${n}`);
    assert.equal(new Set(state.matchups.map((m) => m.prompt)).size, n, 'no repeated prompts');
    if (n > 3) assert.equal(pairs.size, n, 'nobody faces the same opponent twice');
  }
});

// ---------------------------------------------------------------- answering

test('answers: only your own prompts, once, cleaned and length-capped', () => {
  const { ctx, state } = start();
  const idx = state.matchups.findIndex((m) => m.entries.some((e) => e.pid === 'a'));
  const notMine = state.matchups.findIndex((m) => !m.entries.some((e) => e.pid === 'a'));
  assert.equal(logic.action(state, 'a', { type: 'answer', m: notMine, text: 'hi' }, ctx), false);
  assert.equal(logic.action(state, 'a', { type: 'answer', m: idx, text: '   ' }, ctx), false);
  ok(logic.action(state, 'a', { type: 'answer', m: idx, text: '  <script>  hello\nthere ' + 'x'.repeat(200) }, ctx));
  const e = state.matchups[idx].entries.find((x) => x.pid === 'a');
  assert.ok(e.text.startsWith('script hello there'));
  assert.equal(e.text.length, 80);
  assert.equal(logic.action(state, 'a', { type: 'answer', m: idx, text: 'again' }, ctx), false);
  assert.equal(cleanAnswer(' a  b '), 'a b');
});

test('the view only shows your own prompts while writing', () => {
  const { ctx, state } = start(['a', 'b', 'c', 'd']);
  const v = logic.view(state, 'a', ctx);
  assert.equal(v.tasks.length, 2);
  assert.equal(v.matchup, null);
  assert.equal(logic.view(state, 'spectator', ctx).tasks, null);
  assert.equal(v.waitingOn.length, 4);
});

test('voting starts once everyone has answered', () => {
  const { ctx, state } = start();
  answerAll(state, ctx);
  assert.equal(state.phase, 'vote');
  assert.ok(state.events === undefined);
  assert.ok(ctx.events.some((e) => e.ev.type === 'voting'));
});

test('answer timer: missing answers forfeit, an empty round is skipped', () => {
  const { ctx, state } = start();
  // Only a answers one prompt.
  const idx = state.matchups.findIndex((m) => m.entries.some((e) => e.pid === 'a'));
  ok(logic.action(state, 'a', { type: 'answer', m: idx, text: 'lonely' }, ctx));
  expire(state, ctx);
  assert.equal(state.phase, 'reveal');
  assert.equal(state.reveal.special, 'forfeit');
  assert.equal(seat(state, 'a').score, FORFEIT);
  // The other prompts had no answers at all, so the round ends after this one.
  expire(state, ctx);
  assert.equal(state.phase, 'scores');

  const g = start();
  expire(g.state, g.ctx);
  assert.equal(g.state.phase, 'scores');
});

// ---------------------------------------------------------------- votes and scoring

test('authors cannot vote on their own matchup; others vote once', () => {
  const { ctx, state } = start(['a', 'b', 'c', 'd']);
  answerAll(state, ctx);
  const m = current(state);
  for (const e of m.entries) assert.equal(logic.action(state, e.pid, { type: 'vote', i: 0 }, ctx), false);
  const [v1, v2] = voters(state);
  assert.equal(logic.action(state, v1.id, { type: 'vote', i: 5 }, ctx), false);
  ok(logic.action(state, v1.id, { type: 'vote', i: 0 }, ctx));
  assert.equal(logic.action(state, v1.id, { type: 'vote', i: 1 }, ctx), false);
  const view = logic.view(state, v1.id, ctx);
  assert.equal(view.voting.mine, 0);
  assert.equal(view.voting.canVote, false);
  // Anonymous until the reveal.
  assert.ok(view.matchup.entries.every((e) => !('pid' in e) && !('name' in e)));
  ok(logic.action(state, v2.id, { type: 'vote', i: 1 }, ctx));
  assert.equal(state.phase, 'reveal');
});

test('round 1 scoring: split pot, win bonus, sweep bonus', () => {
  const { ctx, state } = start(['a', 'b', 'c', 'd', 'e']);
  answerAll(state, ctx);
  // Three voters per matchup. First: 2-1.
  let m = current(state);
  let [x, y, z] = voters(state);
  logic.action(state, x.id, { type: 'vote', i: 0 }, ctx);
  logic.action(state, y.id, { type: 'vote', i: 0 }, ctx);
  logic.action(state, z.id, { type: 'vote', i: 1 }, ctx);
  assert.equal(state.phase, 'reveal');
  const r = state.reveal;
  assert.deepEqual(r.winners, [0]);
  assert.equal(r.sweep, null);
  assert.equal(r.entries[0].points, Math.round((POT * 2) / 3 / 10) * 10 + WIN_BONUS);
  assert.equal(r.entries[1].points, Math.round(POT / 3 / 10) * 10);
  assert.equal(seat(state, m.entries[0].pid).score, r.entries[0].points);
  assert.deepEqual(r.entries[0].voters.sort(), [x.id, y.id].sort());

  // Next: a clean sweep.
  expire(state, ctx);
  assert.equal(state.phase, 'vote');
  m = current(state);
  for (const v of voters(state)) logic.action(state, v.id, { type: 'vote', i: 1 }, ctx);
  assert.equal(state.reveal.sweep, 1);
  assert.equal(state.reveal.entries[1].points, POT + WIN_BONUS + SWEEP_BONUS);
  assert.equal(state.reveal.entries[0].points, 0);
});

test('round 2 is worth double', () => {
  const { ctx, state } = start(['a', 'b', 'c']);
  // Play through round 1 by timing everything out.
  answerAll(state, ctx);
  while (state.phase !== 'scores') expire(state, ctx);
  expire(state, ctx);
  assert.equal(state.round, 2);
  assert.equal(state.phase, 'answer');
  const before = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
  answerAll(state, ctx);
  const [v] = voters(state);
  logic.action(state, v.id, { type: 'vote', i: 0 }, ctx);
  const winner = current(state).entries[0].pid;
  assert.equal(seat(state, winner).score - before[winner], 2 * (POT + WIN_BONUS + SWEEP_BONUS));
});

test('identical answers are a jinx: no vote, no points', () => {
  const { ctx, state } = start();
  answerAll(state, ctx, () => 'The Same Thing!');
  assert.equal(state.phase, 'reveal');
  assert.equal(state.reveal.special, 'jinx');
  assert.ok(state.players.every((p) => p.score === 0));
  assert.ok(sameAnswer('Hello, world', 'hello world'));
  assert.ok(!sameAnswer('!!!', '???'));
});

test('the audience votes for a crowd bonus without splitting the pot', () => {
  const { ctx, state } = start(['a', 'b', 'c']);
  answerAll(state, ctx);
  ok(logic.action(state, 'fan1', { type: 'vote', i: 1 }, ctx));
  ok(logic.action(state, 'fan2', { type: 'vote', i: 1 }, ctx));
  assert.equal(logic.action(state, 'fan1', { type: 'vote', i: 0 }, ctx), false);
  assert.equal(state.phase, 'vote', 'the audience doesn’t hold things up or end the vote');
  const [v] = voters(state);
  logic.action(state, v.id, { type: 'vote', i: 0 }, ctx);
  const r = state.reveal;
  assert.equal(r.entries[0].points, POT + WIN_BONUS + SWEEP_BONUS);
  assert.equal(r.crowdPick, 1);
  assert.equal(r.entries[1].points, CROWD_BONUS);
  assert.equal(r.entries[1].crowd, 2);

  const g = start(['a', 'b', 'c'], { audience: false });
  answerAll(g.state, g.ctx);
  assert.equal(logic.action(g.state, 'fan1', { type: 'vote', i: 1 }, g.ctx), false);
});

test('vote timer: missing voters are skipped', () => {
  const { ctx, state } = start(['a', 'b', 'c', 'd']);
  answerAll(state, ctx);
  const [v] = voters(state);
  logic.action(state, v.id, { type: 'vote', i: 0 }, ctx);
  assert.equal(state.phase, 'vote');
  expire(state, ctx);
  assert.equal(state.phase, 'reveal');
  assert.equal(state.reveal.entries[0].points, POT + WIN_BONUS + SWEEP_BONUS);
});

// ---------------------------------------------------------------- the Last Quip and the end

function toFinal(players, over = {}) {
  const g = start(players, over);
  while (g.state.phase !== 'answer' || g.state.round <= g.state.rounds) {
    if (g.state.phase === 'answer') answerAll(g.state, g.ctx);
    else expire(g.state, g.ctx);
  }
  return g;
}

test('the Last Quip: one prompt for everyone, three votes each, points per vote', () => {
  const { ctx, state } = toFinal(['a', 'b', 'c', 'd']);
  assert.equal(state.round, 3);
  assert.equal(state.matchups.length, 1);
  assert.equal(state.matchups[0].entries.length, 4);
  const v = logic.view(state, 'a', ctx);
  assert.equal(v.final, true);
  assert.equal(v.tasks.length, 1);
  answerAll(state, ctx);
  assert.equal(state.phase, 'vote');
  const scores = Object.fromEntries(state.players.map((p) => [p.id, p.score]));
  const entries = current(state).entries;
  const idx = (pid) => entries.findIndex((e) => e.pid === pid);
  // You can't vote for yourself, and you need exactly three votes.
  assert.equal(logic.action(state, 'a', { type: 'vote', picks: [idx('a'), idx('b'), idx('b')] }, ctx), false);
  assert.equal(logic.action(state, 'a', { type: 'vote', picks: [idx('b')] }, ctx), false);
  ok(logic.action(state, 'a', { type: 'vote', picks: [idx('b'), idx('b'), idx('c')] }, ctx));
  ok(logic.action(state, 'b', { type: 'vote', picks: [idx('c'), idx('c'), idx('c')] }, ctx));
  ok(logic.action(state, 'c', { type: 'vote', picks: [idx('b'), idx('d'), idx('a')] }, ctx));
  assert.equal(state.phase, 'vote');
  ok(logic.action(state, 'd', { type: 'vote', picks: [idx('c'), idx('a'), idx('b')] }, ctx));
  assert.equal(state.phase, 'reveal');
  const gain = (pid) => seat(state, pid).score - scores[pid];
  assert.equal(gain('c'), 5 * FINAL_VOTE + 0);
  assert.equal(gain('b'), 4 * FINAL_VOTE);
  assert.equal(gain('a'), 2 * FINAL_VOTE);
  assert.equal(gain('d'), 1 * FINAL_VOTE);
  assert.deepEqual(state.reveal.winners, [idx('c')]);
  assert.equal(FINAL_VOTES, 3);
  expire(state, ctx);
  assert.equal(state.phase, 'over');
  assert.equal(state.over, true);
  const end = logic.view(state, 'a', ctx);
  assert.ok(end.history.length > 0);
});

test('without the Last Quip the game ends after the last head-to-head round', () => {
  const { ctx, state } = start(['a', 'b', 'c'], { rounds: 1, final: false });
  answerAll(state, ctx);
  while (!state.over) expire(state, ctx);
  assert.equal(state.round, 1);
});

// ---------------------------------------------------------------- people coming and going

test('a player leaving mid-answer forfeits their matchups', () => {
  const { ctx, state } = start(['a', 'b', 'c', 'd']);
  state.matchups.forEach((m, i) => {
    for (const e of m.entries) if (e.pid !== 'd') logic.action(state, e.pid, { type: 'answer', m: i, text: `${e.pid}${i}` }, ctx);
  });
  assert.equal(state.phase, 'answer');
  logic.leave(state, 'd', ctx);
  assert.equal(state.phase !== 'answer', true);
  // Play out the round: d's two matchups should be forfeits for their opponents.
  let forfeits = 0;
  while (state.phase !== 'scores') {
    if (state.phase === 'reveal' && state.reveal.special === 'forfeit') forfeits++;
    expire(state, ctx);
  }
  assert.equal(forfeits, 2);
  assert.equal(seat(state, 'd').score, 0);
});

test('disconnected players don’t hold up writing or voting', () => {
  const { ctx, state } = start(['a', 'b', 'c', 'd']);
  ctx.isConnected = (id) => id !== 'd';
  state.matchups.forEach((m, i) => {
    for (const e of m.entries) if (e.pid !== 'd') logic.action(state, e.pid, { type: 'answer', m: i, text: `${e.pid}${i}` }, ctx);
  });
  assert.notEqual(state.phase, 'answer');
});

test('too few players pauses the game until someone joins', () => {
  const { ctx, state } = start(['a', 'b', 'c'], { rounds: 3 });
  logic.leave(state, 'c', ctx);
  while (state.phase !== 'scores') expire(state, ctx);
  expire(state, ctx);
  assert.equal(state.phase, 'waiting');
  ok(logic.action(state, 'z', { type: 'join' }, ctx));
  assert.equal(state.phase, 'answer');
  assert.ok(state.matchups.some((m) => m.entries.some((e) => e.pid === 'z')));
  assert.ok(ctx.players.includes('z'));
});

test('joining mid-round: seated now, prompts from the next round, can vote meanwhile', () => {
  const { ctx, state } = start(['a', 'b', 'c']);
  ok(logic.action(state, 'z', { type: 'join' }, ctx));
  assert.equal(logic.action(state, 'z', { type: 'join' }, ctx), false);
  assert.deepEqual(logic.view(state, 'z', ctx).tasks, []);
  answerAll(state, ctx);
  assert.ok(voters(state).some((p) => p.id === 'z'));
  assert.equal(logic.view(state, 'z', ctx).voting.canVote, true);
});

test('with "Host plays" off the host is the main screen: not seated, can’t act', () => {
  const ctx = makeCtx({ players: ['h', 'a', 'b', 'c'], settings: { ...defaults, hostPlays: false }, assets: { prompts: PROMPTS } });
  ctx.hostId = 'h';
  const state = logic.setup(ctx);
  assert.deepEqual(state.players.map((p) => p.id), ['a', 'b', 'c']);
  assert.ok(state.matchups.every((m) => m.entries.every((e) => e.pid !== 'h')));
  const v = logic.view(state, 'h', ctx);
  assert.equal(v.isScreen, true);
  assert.equal(v.canJoin, false);
  assert.equal(v.tasks, null);
  assert.equal(logic.action(state, 'h', { type: 'join' }, ctx), false);
  answerAll(state, ctx);
  assert.equal(logic.view(state, 'h', ctx).voting.canVote, false);
  assert.equal(logic.action(state, 'h', { type: 'vote', i: 0 }, ctx), false);
  // Needs three players besides the host.
  const few = makeCtx({ players: ['h', 'a', 'b'], settings: { ...defaults, hostPlays: false }, assets: { prompts: PROMPTS } });
  few.hostId = 'h';
  assert.throws(() => logic.setup(few), /besides the host/);
  // Host plays (the default): everyone is seated.
  const all = makeCtx({ players: ['h', 'a', 'b'], settings: defaults, assets: { prompts: PROMPTS } });
  all.hostId = 'h';
  assert.equal(logic.setup(all).players.length, 3);
});

test('reveals give the main screen voter ids and per-player voted flags', () => {
  const { ctx, state } = start(['a', 'b', 'c', 'd']);
  answerAll(state, ctx);
  const [v1] = voters(state);
  logic.action(state, v1.id, { type: 'vote', i: 1 }, ctx);
  const during = logic.view(state, 'spectator', ctx);
  assert.equal(during.players.find((p) => p.id === v1.id).voted, true);
  expire(state, ctx);
  const r = logic.view(state, 'spectator', ctx).reveal;
  assert.deepEqual(r.entries[1].voterIds, [v1.id]);
});
