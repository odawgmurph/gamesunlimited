/**
 * Mafia — rules. Runs only on the host; the view() function decides exactly
 * what each player is allowed to know (their own role, teammates, chats).
 */
import { ROLES } from './roles.js';

const INTRO_MS = 10000;
const VERDICT_MS = 6000;
const CHAT_LIMIT = 400;

const isMafia = (p) => ROLES[p.role].team === 'mafia';

export function buildRoles(n, s, random = Math.random) {
  let mafia = s.mafiaCount > 0 ? s.mafiaCount : Math.max(1, Math.floor(n / 4));
  mafia = Math.min(mafia, Math.max(1, Math.ceil(n / 2) - 1)); // mafia must start as a minority
  const roles = [];
  for (let i = 0; i < mafia; i++) roles.push(i === 0 && s.godfather ? 'godfather' : 'mafioso');
  const specials = [];
  if (s.doctor) specials.push('doctor');
  if (s.cop) specials.push('cop');
  if (s.vigilante) specials.push('vigilante');
  if (s.jester && n >= 5) specials.push('jester');
  for (const r of specials) if (roles.length < n) roles.push(r);
  while (roles.length < n) roles.push('villager');
  // Fisher–Yates
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  return roles;
}

function say(state, msg) {
  state.chat.push({ id: state.chatSeq++, ts: Date.now(), ...msg });
  if (state.chat.length > CHAT_LIMIT) state.chat.splice(0, state.chat.length - CHAT_LIMIT);
}
const sys = (state, text, extra = {}) => say(state, { ch: 'town', sys: true, text, ...extra });

const living = (state) => state.players.filter((p) => p.alive);
const player = (state, id) => state.players.find((p) => p.id === id);

function roleText(state, p) {
  return state.settings.reveal ? ` They were ${article(ROLES[p.role].name)}.` : '';
}
function article(w) {
  return (/^[aeiou]/i.test(w) ? 'an ' : 'a ') + w;
}

function kill(state, p, how, ctx) {
  if (!p.alive) return;
  p.alive = false;
  p.diedOn = { phase: state.phase, day: state.day, how };
  if (state.settings.reveal) p.revealed = true;
  ctx.emit({ type: 'death', who: p.id });
}

function checkWin(state, ctx) {
  const alive = living(state);
  const mafia = alive.filter(isMafia).length;
  const others = alive.length - mafia;
  let winner = null;
  if (mafia === 0) winner = 'town';
  else if (mafia >= others) winner = 'mafia';
  if (!winner) return false;
  state.over = true;
  state.phase = 'over';
  state.winner = winner;
  for (const p of state.players) p.revealed = true;
  sys(state, winner === 'town' ? '🎉 The town wins! All the mafia are gone.' : '🔪 The mafia wins! They now control the town.');
  if (state.jesterWinners.length) sys(state, `🃏 ${state.jesterWinners.map(ctx.name).join(', ')} also won as the Jester.`);
  ctx.emit({ type: 'over', winner });
  return true;
}

function startNight(state, ctx) {
  state.phase = 'night';
  state.phaseEndsAt = ctx.now + state.settings.nightLength * 1000;
  state.night = {}; // actorId -> targetId | 'skip'
  sys(state, `🌙 Night ${state.day + (state.settings.start === 'night' ? 1 : 0)} falls. Everyone goes to sleep…`);
  ctx.emit({ type: 'phase', phase: 'night' });
}

function startDay(state, ctx) {
  state.day++;
  state.phase = 'day';
  state.phaseEndsAt = ctx.now + state.settings.dayLength * 1000;
  state.votes = {};
  sys(state, `☀️ Day ${state.day} begins. Discuss, then vote. A majority (${majority(state)}) executes someone.`);
  ctx.emit({ type: 'phase', phase: 'day' });
}

function majority(state) {
  return Math.floor(living(state).length / 2) + 1;
}

/** Who still needs to act tonight (used to end the night early). */
function nightActors(state) {
  return living(state).filter((p) => {
    const kind = ROLES[p.role].night;
    if (!kind) return false;
    if (kind === 'shoot' && p.bullets <= 0) return false;
    return true;
  });
}

function validTargets(state, p) {
  const kind = ROLES[p.role].night;
  const alive = living(state);
  if (kind === 'kill') return alive.filter((t) => !isMafia(t)).map((t) => t.id);
  if (kind === 'protect') return alive.filter((t) => t.id !== p.lastProtected && (state.settings.selfProtect !== false || t.id !== p.id)).map((t) => t.id);
  if (kind === 'investigate' || kind === 'shoot') return alive.filter((t) => t.id !== p.id).map((t) => t.id);
  return [];
}

function mafiaTarget(state) {
  const mafia = living(state).filter(isMafia);
  const gf = mafia.find((p) => p.role === 'godfather');
  if (gf && state.night[gf.id] && state.night[gf.id] !== 'skip') return state.night[gf.id];
  const tally = {};
  let best = null;
  for (const m of mafia) {
    const t = state.night[m.id];
    if (!t || t === 'skip') continue;
    tally[t] = (tally[t] || 0) + 1;
    if (!best || tally[t] > tally[best]) best = t;
  }
  return best;
}

function resolveNight(state, ctx) {
  const n = state.night;
  const actors = living(state);
  const byRole = (r) => actors.filter((p) => p.role === r);
  const protectedIds = new Set();
  for (const d of byRole('doctor')) {
    const t = n[d.id];
    d.lastProtected = t && t !== 'skip' ? t : null;
    if (d.lastProtected) protectedIds.add(t);
  }
  // Investigations see roles as they were at the start of the night.
  for (const c of byRole('cop')) {
    const t = player(state, n[c.id]);
    if (!t) continue;
    const guilty = isMafia(t) && t.role !== 'godfather';
    say(state, {
      ch: 'town',
      sys: true,
      to: [c.id],
      text: `🔎 Your investigation: ${ctx.name(t.id)} is ${guilty ? 'MAFIA' : 'not mafia'}.`,
    });
  }
  const attacks = [];
  const mt = mafiaTarget(state);
  if (mt) attacks.push({ target: mt, by: 'mafia' });
  for (const v of byRole('vigilante')) {
    const t = n[v.id];
    if (t && t !== 'skip' && v.bullets > 0) {
      v.bullets--;
      attacks.push({ target: t, by: 'vigilante' });
    }
  }
  const deaths = [];
  let saved = false;
  for (const a of attacks) {
    const p = player(state, a.target);
    if (!p || !p.alive) continue;
    if (protectedIds.has(p.id)) {
      saved = true;
      continue;
    }
    kill(state, p, a.by, ctx);
    deaths.push(p);
  }
  if (!deaths.length) sys(state, saved ? '🌅 Morning comes. Someone was attacked in the night, but survived!' : '🌅 Morning comes. Nobody died last night.');
  for (const p of deaths) sys(state, `🌅 ${ctx.name(p.id)} was found dead this morning.${roleText(state, p)}`);
  state.night = {};
  if (!checkWin(state, ctx)) startDay(state, ctx);
}

function endDay(state, ctx, target) {
  state.votes = {};
  if (target && target !== 'skip') {
    const p = player(state, target);
    kill(state, p, 'vote', ctx);
    sys(state, `⚖️ The town has voted to execute ${ctx.name(p.id)}.${roleText(state, p)}`);
    if (p.role === 'jester') {
      state.jesterWinners.push(p.id);
      sys(state, `🃏 ${ctx.name(p.id)} was the Jester — and that’s exactly what they wanted.`);
    }
    state.lastLynch = p.id;
  } else {
    sys(state, target === 'skip' ? '⚖️ The town decided not to execute anyone today.' : '⚖️ Time ran out. Nobody was executed today.');
    state.lastLynch = null;
  }
  if (checkWin(state, ctx)) return;
  state.phase = 'verdict';
  state.phaseEndsAt = ctx.now + VERDICT_MS;
}

function tallyVotes(state) {
  const tally = {};
  for (const [voter, t] of Object.entries(state.votes)) {
    if (!player(state, voter)?.alive) continue;
    tally[t] = (tally[t] || 0) + 1;
  }
  return tally;
}

function checkVotes(state, ctx) {
  const tally = tallyVotes(state);
  const need = majority(state);
  for (const [t, n] of Object.entries(tally)) if (n >= need) return endDay(state, ctx, t), true;
  return false;
}

function maybeEndNight(state, ctx) {
  const pending = nightActors(state).filter((p) => !state.night[p.id]);
  if (pending.length === 0) {
    // Short pause so the last actor's choice isn't instantly obvious.
    state.phaseEndsAt = Math.min(state.phaseEndsAt, ctx.now + 2500);
  }
}

export const logic = {
  setup(ctx) {
    const roles = buildRoles(ctx.players.length, ctx.settings, ctx.random);
    const state = {
      settings: { ...ctx.settings },
      players: ctx.players.map((id, i) => ({
        id,
        role: roles[i],
        alive: true,
        revealed: false,
        bullets: roles[i] === 'vigilante' ? 1 : 0,
        lastProtected: null,
      })),
      phase: 'intro',
      phaseEndsAt: ctx.now + INTRO_MS,
      day: 0,
      votes: {},
      night: {},
      chat: [],
      chatSeq: 1,
      jesterWinners: [],
      over: false,
      winner: null,
    };
    sys(state, '🎭 Roles have been handed out. Check yours — and keep it to yourself.');
    return state;
  },

  action(state, pid, a, ctx) {
    const me = player(state, pid);
    if (a.type === 'chat') {
      const text = String(a.text || '').trim().slice(0, 400);
      if (!text) return false;
      const ch = channelsFor(state, pid).write.includes(a.ch) ? a.ch : null;
      if (!ch) return false;
      say(state, { ch, from: pid, text });
      return;
    }
    if (!me || !me.alive || state.over) return false;

    if (a.type === 'vote' && state.phase === 'day') {
      const t = a.target;
      if (t == null) delete state.votes[pid];
      else if (t === 'skip' || player(state, t)?.alive) state.votes[pid] = t;
      else return false;
      checkVotes(state, ctx);
      return;
    }

    if (a.type === 'night' && state.phase === 'night') {
      const kind = ROLES[me.role].night;
      if (!kind) return false;
      if (kind === 'shoot' && me.bullets <= 0) return false;
      if (a.target === 'skip' || a.target == null) state.night[pid] = a.target === 'skip' ? 'skip' : undefined;
      else if (validTargets(state, me).includes(a.target)) state.night[pid] = a.target;
      else return false;
      if (state.night[pid] === undefined) delete state.night[pid];
      if (kind === 'kill' && state.night[pid]) {
        const verb = state.night[pid] === 'skip' ? 'wants no kill tonight' : `wants to kill ${ctx.name(state.night[pid])}`;
        say(state, { ch: 'mafia', sys: true, text: `${ctx.name(pid)} ${verb}.` });
      }
      maybeEndNight(state, ctx);
      return;
    }
    return false;
  },

  tick(state, ctx) {
    if (state.over || ctx.now < state.phaseEndsAt) return false;
    switch (state.phase) {
      case 'intro':
        if (state.settings.start === 'day') startDay(state, ctx);
        else startNight(state, ctx);
        break;
      case 'night':
        resolveNight(state, ctx);
        break;
      case 'day':
        endDay(state, ctx, null);
        break;
      case 'verdict':
        startNight(state, ctx);
        break;
    }
  },

  leave(state, pid, ctx) {
    const p = player(state, pid);
    if (!p || !p.alive || state.over) return false;
    kill(state, p, 'left', ctx);
    p.left = true;
    sys(state, `🚪 ${ctx.name(pid)} left the game.${roleText(state, p)}`);
    if (checkWin(state, ctx)) return;
    if (state.phase === 'day') checkVotes(state, ctx);
    if (state.phase === 'night') maybeEndNight(state, ctx);
  },

  view(state, viewer, ctx) {
    const me = player(state, viewer);
    const canSeeAll = state.over || !me || !me.alive;
    const meMafia = me && isMafia(me);
    const { read, write } = channelsFor(state, viewer);

    const players = state.players.map((p) => {
      let role = null;
      if (p.id === viewer || p.revealed || state.over) role = p.role;
      else if (meMafia && isMafia(p)) role = p.role;
      else if (canSeeAll && state.settings.deadSeeAll) role = p.role;
      return { id: p.id, name: ctx.name(p.id), alive: p.alive, role, left: !!p.left, connected: ctx.isConnected?.(p.id) ?? true };
    });

    let action = null;
    if (me && me.alive && state.phase === 'night' && ROLES[me.role].night) {
      const kind = ROLES[me.role].night;
      if (!(kind === 'shoot' && me.bullets <= 0)) {
        action = { kind, targets: validTargets(state, me), choice: state.night[viewer] ?? null };
        if (kind === 'kill') {
          action.team = living(state)
            .filter(isMafia)
            .map((m) => ({ id: m.id, choice: state.night[m.id] ?? null }));
        }
      }
    }

    return {
      phase: state.phase,
      day: state.day,
      phaseEndsAt: state.phaseEndsAt,
      players,
      me: me ? { id: me.id, role: me.role, alive: me.alive, bullets: me.bullets } : null,
      votes: state.phase === 'day' ? state.votes : {},
      majority: majority(state),
      action,
      chat: state.chat.filter((m) => read.includes(m.ch) && (!m.to || m.to.includes(viewer) || state.over)),
      channels: { read, write },
      over: state.over,
      winner: state.winner,
      jesterWinners: state.jesterWinners,
      settings: { reveal: state.settings.reveal, start: state.settings.start },
    };
  },
};

/** Which chat channels a member can read and write right now. */
export function channelsFor(state, id) {
  const p = state.players.find((x) => x.id === id);
  if (state.over) return { read: ['town', 'mafia', 'dead'], write: ['town'] };
  if (!p || !p.alive) {
    return { read: state.settings.deadSeeAll ? ['town', 'mafia', 'dead'] : ['town', 'dead'], write: ['dead'] };
  }
  const read = ['town'];
  const write = [];
  if (state.phase === 'day' || state.phase === 'intro' || state.phase === 'verdict') write.push('town');
  if (isMafia(p)) {
    read.push('mafia');
    if (state.phase === 'night' || state.phase === 'intro') write.push('mafia');
  }
  return { read, write };
}
