/**
 * Quips: rules. Runs only on the host.
 *
 * Head-to-head rounds: every player gets two prompts, and every prompt goes to
 * exactly two players (seat i answers prompts i and i+1, round the table).
 * Then the prompts come up one at a time with their two answers, anonymously,
 * and everyone who didn't write them votes. The pot is split by vote share,
 * with bonuses for winning, for a clean sweep and for the crowd's pick.
 * Round 2 is worth double, round 3 triple.
 *
 * The Last Quip: one prompt for everyone. Each player gets three votes to
 * spread over the others' answers, and every vote is worth points.
 *
 * Identical answers are a jinx (nobody scores). If only one of the pair
 * answers, they win by forfeit.
 *
 * Spectators can vote too, when the host allows it. Their votes don't split
 * the pot; whichever answer the crowd prefers earns a bonus.
 */
import { PROMPTS } from './prompts.js';
import { cleanPrompt, parsePrompts, MAX_CUSTOM } from './custom.js';

export const MAX_ANSWER = 80;
export const FINAL_VOTES = 3;
const MAX_PLAYERS = 10;
const MIN_PRESENT = 3;
const HISTORY = 120;

export const POT = 1000; // split between the two answers by vote share, × round
export const WIN_BONUS = 100; // × round
export const SWEEP_BONUS = 250; // × round, every player vote went one way
export const CROWD_BONUS = 100; // × round, the audience's favourite
export const FORFEIT = 500; // × round, your opponent didn't answer
export const FINAL_VOTE = 400; // per vote in the Last Quip
export const FINAL_CROWD = 300;

/** Seconds for each phase, by the "Timer" setting. */
export const TIMERS = {
  fast: { answer: 60, final: 40, vote: 12 },
  normal: { answer: 90, final: 60, vote: 20 },
  slow: { answer: 150, final: 100, vote: 30 },
  off: null,
};
const REVEAL_MS = 7500;
const FINAL_REVEAL_MS = 12000;
const SKIP_MS = 4500;
const SCORES_MS = 8000;

function shuffle(arr, ctx) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(ctx.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const round10 = (n) => Math.round(n / 10) * 10;

/** Built-in (unless switched off) plus custom prompts, without duplicates. */
export function promptPool(settings, builtIn = PROMPTS) {
  const seen = new Set();
  const out = [];
  for (const raw of [...(settings.builtIn === false ? [] : builtIn), ...parsePrompts(settings.custom).slice(0, MAX_CUSTOM)]) {
    const t = cleanPrompt(raw);
    const k = t.toLowerCase();
    if (!t || seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

/** How many prompts a whole game uses with n players. */
export function promptsNeeded(n, settings) {
  return n * settings.rounds + (settings.final ? 1 : 0);
}

/** Answers that would read the same out loud count as a jinx. */
export function sameAnswer(a, b) {
  const k = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  return k(a) !== '' && k(a) === k(b);
}

/**
 * Fills in "{player}" with someone in the game, preferring someone who isn't
 * answering the prompt.
 */
export function personalize(prompt, authors, everyone, ctx) {
  if (!prompt.includes('{player}')) return prompt;
  const others = everyone.filter((id) => !authors.includes(id));
  const pool = others.length ? others : everyone;
  return prompt.replace(/\{player\}/g, () => ctx.name(pool[Math.floor(ctx.random() * pool.length)]));
}

export function cleanAnswer(raw) {
  return String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ANSWER);
}

// ---------------------------------------------------------------- players

const seat = (state, id) => state.players.find((p) => p.id === id);
const present = (state, ctx) => state.players.filter((p) => !p.left && ctx.isConnected(p.id));
const isFinal = (state) => state.hasFinal && state.round === state.rounds + 1;
const mult = (state) => (isFinal(state) ? 1 : state.round);

function drawPrompt(state, ctx) {
  if (!state.pool.length) {
    // Only when people joined mid-game and the list ran dry: reuse old prompts.
    state.pool = shuffle(state.used, ctx);
    state.used = [];
  }
  const p = state.pool.pop() ?? '';
  state.used.push(p);
  return p;
}

/** Players still writing this round. */
function writing(state, ctx) {
  return present(state, ctx).filter((p) => state.matchups.some((m) => m.entries.some((e) => e.pid === p.id && e.text == null)));
}

/** Answers this member may vote for: anything they didn't write. */
function voteTargets(state, voter) {
  const m = state.matchups[state.cur];
  return m.entries.map((e, i) => (e.pid !== voter && e.text != null ? i : -1)).filter((i) => i >= 0);
}

/** In head-to-heads the two authors sit the vote out; in the Last Quip everyone votes. */
function mayVote(state, pid) {
  const m = state.matchups[state.cur];
  if (!isFinal(state) && m.entries.some((e) => e.pid === pid)) return false;
  return voteTargets(state, pid).length > 0;
}

/** Players who may vote on the current matchup. */
function eligibleVoters(state, ctx) {
  return present(state, ctx).filter((p) => mayVote(state, p.id));
}

// ---------------------------------------------------------------- flow

function timerFor(state, kind) {
  const t = TIMERS[state.timer];
  return t ? t[kind] * 1000 : 0;
}

function startRound(state, ctx) {
  state.matchups = [];
  state.queue = [];
  state.cur = -1;
  state.done = 0;
  state.reveal = null;
  state.votes = {};
  state.crowd = {};
  const here = present(state, ctx);
  if (here.length < MIN_PRESENT) {
    state.phase = 'waiting';
    state.deadline = 0;
    return;
  }
  state.round++;
  for (const p of state.players) p.roundStart = p.score;
  const ids = shuffle(here.map((p) => p.id), ctx);
  const deal = (authors) => ({ prompt: personalize(drawPrompt(state, ctx), authors, ids, ctx), entries: authors.map((pid) => ({ pid, text: null })) });
  if (isFinal(state)) state.matchups.push(deal(ids));
  else for (let i = 0; i < ids.length; i++) state.matchups.push(deal([ids[i], ids[(i + 1) % ids.length]]));
  state.phase = 'answer';
  state.startedAt = ctx.now;
  const ms = timerFor(state, isFinal(state) ? 'final' : 'answer');
  state.deadline = ms && ctx.now + ms;
  ctx.emit({ type: 'round', round: state.round, final: isFinal(state) });
}

function startVoting(state, ctx) {
  state.queue = shuffle(state.matchups.map((_, i) => i), ctx);
  ctx.emit({ type: 'voting' });
  nextMatchup(state, ctx);
}

/** Puts the next prompt up for a vote, or ends the round. */
function nextMatchup(state, ctx) {
  state.votes = {};
  state.crowd = {};
  state.reveal = null;
  while (state.queue.length) {
    const idx = state.queue.shift();
    const m = state.matchups[idx];
    const answered = m.entries.filter((e) => e.text != null);
    if (!answered.length) continue; // nobody answered: skip it quietly
    state.cur = idx;
    state.done++;
    m.entries = shuffle(m.entries, ctx);
    if (answered.length === 1) return tally(state, ctx, 'forfeit');
    if (!isFinal(state) && sameAnswer(m.entries[0].text, m.entries[1].text)) return tally(state, ctx, 'jinx');
    state.phase = 'vote';
    state.startedAt = ctx.now;
    const ms = timerFor(state, 'vote') * (isFinal(state) ? 2 : 1);
    state.deadline = ms && ctx.now + ms;
    ctx.emit({ type: 'vote', final: isFinal(state) });
    // Nobody can vote (e.g. everyone else dropped): show the result straight away.
    if (!eligibleVoters(state, ctx).length) tally(state, ctx);
    return;
  }
  endRound(state, ctx);
}

function endRound(state, ctx) {
  state.cur = -1;
  state.reveal = null;
  const last = isFinal(state) || (!state.hasFinal && state.round >= state.rounds);
  if (last) return finish(state, ctx);
  state.phase = 'scores';
  state.startedAt = ctx.now;
  state.deadline = ctx.now + SCORES_MS;
  ctx.emit({ type: 'scores' });
}

function finish(state, ctx) {
  state.phase = 'over';
  state.over = true;
  state.deadline = 0;
  const top = Math.max(...state.players.map((p) => p.score));
  ctx.emit({ type: 'over', winners: state.players.filter((p) => p.score === top).map((p) => p.id) });
}

/** Counts the votes, awards points and shows who wrote what. */
function tally(state, ctx, special = null) {
  const m = state.matchups[state.cur];
  const final = isFinal(state);
  const x = mult(state);
  const n = m.entries.length;
  const votes = Array(n).fill(0);
  const crowd = Array(n).fill(0);
  const voters = Array.from({ length: n }, () => []);
  for (const [vid, v] of Object.entries(state.votes)) {
    for (const i of [].concat(v)) {
      votes[i]++;
      voters[i].push(vid);
    }
  }
  for (const v of Object.values(state.crowd)) for (const i of [].concat(v)) crowd[i]++;

  const points = Array(n).fill(0);
  let sweep = null;
  let winners = [];
  let crowdPick = null;
  const total = votes.reduce((a, b) => a + b, 0);
  const crowdTotal = crowd.reduce((a, b) => a + b, 0);

  if (special === 'jinx') {
    // Nobody scores.
  } else if (special === 'forfeit') {
    const i = m.entries.findIndex((e) => e.text != null);
    points[i] = (final ? FINAL_VOTE : FORFEIT) * x;
    winners = [i];
  } else if (final) {
    for (let i = 0; i < n; i++) points[i] = votes[i] * FINAL_VOTE;
    const top = Math.max(...votes);
    if (top > 0) winners = votes.map((v, i) => (v === top ? i : -1)).filter((i) => i >= 0);
  } else {
    if (total > 0) for (let i = 0; i < n; i++) points[i] = round10((POT * x * votes[i]) / total);
    const [a, b] = votes;
    if (a !== b) {
      const w = a > b ? 0 : 1;
      winners = [w];
      points[w] += WIN_BONUS * x;
      if (votes[1 - w] === 0) {
        sweep = w;
        points[w] += SWEEP_BONUS * x;
      }
    }
  }
  if (!special && crowdTotal > 0) {
    const top = Math.max(...crowd);
    const tops = crowd.filter((c) => c === top).length;
    if (tops === 1) {
      crowdPick = crowd.indexOf(top);
      points[crowdPick] += final ? FINAL_CROWD : CROWD_BONUS * x;
    }
  }

  m.entries.forEach((e, i) => {
    const p = seat(state, e.pid);
    if (p) p.score += points[i];
  });

  state.reveal = {
    special,
    sweep,
    winners,
    crowdPick,
    entries: m.entries.map((e, i) => ({ pid: e.pid, text: e.text, votes: votes[i], crowd: crowd[i], points: points[i], voters: voters[i] })),
  };
  state.history.push({
    round: state.round,
    final,
    prompt: m.prompt,
    special,
    entries: state.reveal.entries.map(({ pid, text, votes: v, points: pts }) => ({ pid, text, votes: v, points: pts })),
    winners,
  });
  if (state.history.length > HISTORY) state.history.shift();
  state.votes = {};
  state.crowd = {};
  state.phase = 'reveal';
  state.startedAt = ctx.now;
  state.deadline = ctx.now + (special && special !== 'forfeit' ? SKIP_MS : final ? FINAL_REVEAL_MS : REVEAL_MS);
  ctx.emit({ type: 'reveal', special, sweep: sweep != null, winners: winners.map((i) => m.entries[i].pid) });
}

/** Moves things along once nobody is left to wait for. */
function advance(state, ctx) {
  if (state.over) return;
  if (state.phase === 'waiting') {
    if (present(state, ctx).length >= MIN_PRESENT) startRound(state, ctx);
    return;
  }
  if (state.phase === 'answer') {
    const anyAnswer = state.matchups.some((m) => m.entries.some((e) => e.text != null));
    if (!writing(state, ctx).length && anyAnswer) startVoting(state, ctx);
    return;
  }
  if (state.phase === 'vote') {
    // Wait for every player who can vote; the audience never holds things up.
    if (!eligibleVoters(state, ctx).some((p) => !(p.id in state.votes))) tally(state, ctx);
  }
}

// ---------------------------------------------------------------- the API

export const logic = {
  setup(ctx) {
    const s = ctx.settings;
    const pool = promptPool(s, ctx.assets?.prompts ?? PROMPTS);
    const need = promptsNeeded(ctx.players.length, s);
    if (pool.length < need) {
      throw new Error(
        pool.length === 0
          ? 'There are no prompts to play with. Turn on the built-in prompts or add your own (one per line).'
          : `Not enough prompts: ${ctx.players.length} players need ${need}, and there ${pool.length === 1 ? 'is' : 'are'} only ${pool.length}. Turn on the built-in prompts or add more of your own.`
      );
    }
    if (ctx.players.length < MIN_PRESENT) throw new Error(`Quips needs at least ${MIN_PRESENT} players.`);
    const state = {
      phase: 'answer',
      over: false,
      round: 0,
      rounds: s.rounds,
      hasFinal: !!s.final,
      timer: TIMERS[s.timer] !== undefined ? s.timer : 'normal',
      audience: !!s.audience,
      players: ctx.players.map((id) => ({ id, score: 0, roundStart: 0, left: false })),
      pool: shuffle(pool, ctx),
      used: [],
      matchups: [],
      queue: [],
      cur: -1,
      done: 0,
      votes: {},
      crowd: {},
      reveal: null,
      deadline: 0,
      startedAt: ctx.now,
      history: [],
    };
    startRound(state, ctx);
    return state;
  },

  action(state, pid, a, ctx) {
    if (state.over || !a || typeof a !== 'object') return false;
    const p = seat(state, pid);
    const playing = !!p && !p.left;

    if (a.type === 'join') {
      if (playing) return false;
      if (state.players.filter((x) => !x.left).length >= MAX_PLAYERS) return false;
      ctx.addPlayer(pid);
      if (p) p.left = false;
      else state.players.push({ id: pid, score: 0, roundStart: 0, left: false });
      ctx.emit({ type: 'joined', who: pid });
      advance(state, ctx);
      return;
    }

    if (a.type === 'answer') {
      if (!playing || state.phase !== 'answer') return false;
      const m = state.matchups[Number(a.m)];
      const e = m?.entries.find((x) => x.pid === pid);
      if (!e || e.text != null) return false;
      const text = cleanAnswer(a.text);
      if (!text) return false;
      e.text = text;
      ctx.emit({ type: 'answered', who: pid });
      advance(state, ctx);
      return;
    }

    if (a.type === 'vote') {
      if (state.phase !== 'vote') return false;
      const targets = voteTargets(state, pid);
      let pick;
      if (isFinal(state)) {
        // Three votes to spread around; stacking them on one answer is fine.
        const picks = Array.isArray(a.picks) ? a.picks.map(Number) : [];
        if (picks.length !== FINAL_VOTES || !picks.every((i) => targets.includes(i))) return false;
        pick = picks;
      } else {
        const i = Number(a.i);
        if (!targets.includes(i)) return false;
        pick = i;
      }
      if (playing) {
        if (!mayVote(state, pid) || pid in state.votes) return false;
        state.votes[pid] = pick;
      } else {
        if (!state.audience || pid in state.crowd) return false;
        state.crowd[pid] = pick;
      }
      ctx.emit({ type: 'voted', who: playing ? pid : null });
      advance(state, ctx);
      return;
    }

    return false;
  },

  tick(state, ctx) {
    if (state.over) return false;
    const before = `${state.phase}/${state.round}/${state.cur}`;
    const due = state.deadline && ctx.now >= state.deadline;
    if (state.phase === 'answer' && due) {
      if (state.matchups.some((m) => m.entries.some((e) => e.text != null))) startVoting(state, ctx);
      else {
        ctx.emit({ type: 'silence' });
        endRound(state, ctx);
      }
    } else if (state.phase === 'vote' && due) tally(state, ctx);
    else if (state.phase === 'reveal' && due) nextMatchup(state, ctx);
    else if (state.phase === 'scores' && due) startRound(state, ctx);
    else advance(state, ctx); // people dropping out shouldn't hold things up
    return `${state.phase}/${state.round}/${state.cur}` === before ? false : undefined;
  },

  leave(state, pid, ctx) {
    const p = seat(state, pid);
    if (!p || p.left) return false;
    p.left = true;
    delete state.votes[pid];
    advance(state, ctx);
  },

  view(state, viewer, ctx) {
    const me = seat(state, viewer);
    const playing = !!me && !me.left;
    const final = isFinal(state);
    const m = state.cur >= 0 ? state.matchups[state.cur] : null;
    const nameOf = (id) => ctx.name(id);
    const waiting = state.phase === 'answer' ? writing(state, ctx).map((p) => p.id) : [];
    const toVote = state.phase === 'vote' ? eligibleVoters(state, ctx).filter((p) => !(p.id in state.votes)).map((p) => p.id) : [];

    const v = {
      phase: state.phase,
      over: state.over,
      round: state.round,
      rounds: state.rounds,
      hasFinal: state.hasFinal,
      final,
      multiplier: mult(state),
      deadline: state.deadline,
      startedAt: state.startedAt,
      you: playing ? viewer : null,
      canJoin: !playing && !state.over && state.players.filter((x) => !x.left).length < MAX_PLAYERS,
      audience: state.audience,
      players: state.players.map((p) => ({
        id: p.id,
        name: nameOf(p.id),
        score: p.score,
        gained: p.score - (p.roundStart || 0),
        left: p.left,
        connected: ctx.isConnected(p.id),
        writing: waiting.includes(p.id),
        toVote: toVote.includes(p.id),
      })),
      waitingOn: state.phase === 'answer' ? waiting : toVote,
      tasks: null,
      matchup: null,
      voting: null,
      reveal: null,
      history: state.over ? state.history.map((h) => ({ ...h, entries: h.entries.map((e) => ({ ...e, name: nameOf(e.pid) })) })) : null,
    };

    if (state.phase === 'answer' && playing) {
      v.tasks = [];
      state.matchups.forEach((mu, i) => {
        const e = mu.entries.find((x) => x.pid === viewer);
        if (e) v.tasks.push({ m: i, prompt: mu.prompt, answer: e.text });
      });
    }

    if ((state.phase === 'vote' || state.phase === 'reveal') && m) {
      const total = state.matchups.filter((x) => x.entries.some((e) => e.text != null)).length;
      v.matchup = {
        prompt: m.prompt,
        index: state.done,
        total: Math.max(total, state.done),
        entries: m.entries.map((e, i) => ({ i, text: e.text, mine: e.pid === viewer })),
      };
    }

    if (state.phase === 'vote' && m) {
      const mine = playing ? state.votes[viewer] : state.crowd[viewer];
      v.voting = {
        canVote: mine === undefined && (playing ? mayVote(state, viewer) : state.audience && voteTargets(state, viewer).length > 0),
        mine: mine ?? null,
        author: m.entries.some((e) => e.pid === viewer),
        crowd: !playing,
        votes: final ? FINAL_VOTES : 1,
        cast: Object.keys(state.votes).length,
        crowdCast: Object.keys(state.crowd).length,
      };
    }

    if (state.phase === 'reveal' && state.reveal) {
      const r = state.reveal;
      v.reveal = {
        special: r.special,
        sweep: r.sweep,
        winners: r.winners,
        crowdPick: r.crowdPick,
        entries: r.entries.map((e, i) => ({
          i,
          text: e.text,
          pid: e.pid,
          name: nameOf(e.pid),
          votes: e.votes,
          crowd: e.crowd,
          points: e.points,
          voters: e.voters.map(nameOf),
          mine: e.pid === viewer,
        })),
      };
    }
    return v;
  },
};
