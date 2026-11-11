/**
 * HostCore: the authoritative room state machine. Exactly one browser in a
 * room runs this at a time (the host). It owns membership, the lobby, chat and
 * the running game, and decides what each member is allowed to see.
 *
 * Everything it knows lives in the plain-object `S`, so the whole thing can be
 * snapshotted to the heir and resumed elsewhere on host migration.
 */
import { succession, heirOf, sanitizeName } from './succession.js';
import { getManifest, getLoadedGame, loadGame, defaultSettings, sanitizeSettings, listGames, minPlayers } from './registry.js';

const MAX_MEMBERS = 30;
const CHAT_LIMIT = 100;
export const STALE_MS = 7000; // no message for this long -> disconnected
const GRACE_LOBBY_MS = 15000; // disconnected this long -> removed (lobby/spectator)
const GRACE_GAME_MS = 45000; // ... for players in a running game
const SNAPSHOT_EVERY_MS = 400;

export function freshRoomState(code, me, name, peerId) {
  const firstGame = listGames()[0];
  return {
    code,
    epoch: 0,
    hostId: me,
    seq: 1,
    promoteSeq: 0,
    members: [{ id: me, name: sanitizeName(name), peerId, seq: 0, promoted: null, connected: true, lastSeen: Date.now() }],
    banned: [],
    lobby: { gameId: firstGame.id, settings: { [firstGame.id]: defaultSettings(firstGame) } },
    chat: [],
    chatSeq: 0,
    game: null,
  };
}

/** Rebuilds an authoritative state from the public room view (when no snapshot is available). */
export function rebuildFromPublic(pub) {
  const S = {
    code: pub.code,
    epoch: pub.epoch,
    hostId: pub.hostId,
    seq: Math.max(0, ...pub.members.map((m) => m.seq)) + 1,
    promoteSeq: Math.max(0, ...pub.members.map((m) => m.promoted ?? 0)) + 1,
    members: pub.members.map((m) => ({ ...m, lastSeen: Date.now() })),
    banned: [],
    lobby: structuredClone(pub.lobby),
    chat: structuredClone(pub.chat || []),
    chatSeq: (pub.chat?.at(-1)?.id ?? 0) + 1,
    game: null,
  };
  if (pub.game) addSystemChat(S, 'The previous host left mid-game and nobody had a backup of the game, so it was reset.');
  return S;
}

function addSystemChat(S, text) {
  S.chat.push({ id: S.chatSeq++, sys: true, text, ts: Date.now() });
  if (S.chat.length > CHAT_LIMIT) S.chat.splice(0, S.chat.length - CHAT_LIMIT);
}

export class HostCore {
  /**
   * @param {object} S authoritative state
   * @param {{ me: string, out: (memberId: string, msg: object) => void, onError?: (e:any)=>void }} io
   */
  constructor(S, io) {
    this.S = S;
    this.io = io;
    this.lastSent = new Map(); // memberId -> serialized state
    this.lastHeir = null;
    this.lastSnapAt = 0;
    this.snapDirty = true;
    this.events = [];
    this.flushQueued = false;
    this.ticking = setInterval(() => this.tick(), 100);
    this.presenceTimer = setInterval(() => this.presence(), 1000);
    if (S.game) this.#ensureGameLoaded(S.game.id);
    this.#ensureGameLoaded(S.lobby.gameId);
  }

  destroy() {
    clearInterval(this.ticking);
    clearInterval(this.presenceTimer);
  }

  member(id) {
    return this.S.members.find((m) => m.id === id);
  }

  sys(text) {
    addSystemChat(this.S, text);
  }

  notice(to, text, level = 'info') {
    this.io.out(to, { t: 'notice', text, level });
  }

  // ---------------------------------------------------------------- membership

  /** Returns null on success or a reason string on denial. */
  join(clientId, name, peerId) {
    const S = this.S;
    if (S.banned.includes(clientId)) return 'You were removed from this room.';
    let m = this.member(clientId);
    if (m) {
      const was = m.connected;
      m.connected = true;
      m.peerId = peerId;
      m.lastSeen = Date.now();
      delete m.disconnectedAt;
      if (name) m.name = sanitizeName(name);
      if (!was) this.sys(`${m.name} reconnected.`);
    } else {
      if (S.members.length >= MAX_MEMBERS) return 'This room is full.';
      m = { id: clientId, name: sanitizeName(name), peerId, seq: S.seq++, promoted: null, connected: true, lastSeen: Date.now() };
      S.members.push(m);
      this.sys(`${m.name} joined.`);
    }
    this.lastSent.delete(clientId);
    this.changed();
    return null;
  }

  seen(memberId) {
    const m = this.member(memberId);
    if (m) m.lastSeen = Date.now();
  }

  disconnected(memberId) {
    const m = this.member(memberId);
    if (!m || !m.connected || memberId === this.io.me) return;
    m.connected = false;
    m.disconnectedAt = Date.now();
    this.sys(`${m.name} disconnected.`);
    this.changed();
  }

  remove(memberId, why = 'left') {
    const S = this.S;
    const m = this.member(memberId);
    if (!m) return;
    S.members = S.members.filter((x) => x.id !== memberId);
    this.lastSent.delete(memberId);
    this.sys(`${m.name} ${why}.`);
    if (S.game && S.game.players.includes(memberId)) this.#gameCall('leave', memberId);
    this.changed();
  }

  presence() {
    const now = Date.now();
    for (const m of [...this.S.members]) {
      if (m.id === this.io.me) {
        m.lastSeen = now;
        continue;
      }
      if (m.connected && now - m.lastSeen > STALE_MS) this.disconnected(m.id);
      if (!m.connected) {
        const inGame = this.S.game && !this.S.game.over && this.S.game.players.includes(m.id);
        if (now - (m.disconnectedAt ?? now) > (inGame ? GRACE_GAME_MS : GRACE_LOBBY_MS)) this.remove(m.id, 'left');
      }
    }
  }

  // ---------------------------------------------------------------- messages

  handle(from, msg) {
    this.seen(from);
    if (msg.t === 'act') return this.#gameCall('action', from, msg.action);
    if (msg.t !== 'cmd') return;
    const S = this.S;
    const isHost = from === S.hostId;
    const target = msg.id ? this.member(msg.id) : null;
    const needHost = () => {
      if (!isHost) this.notice(from, 'Only the host can do that.', 'error');
      return isHost;
    };

    switch (msg.cmd) {
      case 'setName': {
        const m = this.member(from);
        const name = sanitizeName(msg.name);
        if (m && name !== m.name) {
          this.sys(`${m.name} is now ${name}.`);
          m.name = name;
        }
        break;
      }
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 300);
        if (!text) return;
        const g = S.game && !S.game.over ? getManifest(S.game.id) : null;
        if (g && g.roomChatDuringGame === false) return this.notice(from, 'Room chat is off during this game.', 'error');
        S.chat.push({ id: S.chatSeq++, from, name: this.member(from)?.name, text, ts: Date.now() });
        if (S.chat.length > CHAT_LIMIT) S.chat.splice(0, S.chat.length - CHAT_LIMIT);
        break;
      }
      case 'leave':
        this.remove(from, 'left');
        return;
      case 'selectGame': {
        if (!needHost() || S.game) return;
        const g = getManifest(msg.gameId);
        if (!g) return;
        S.lobby.gameId = g.id;
        S.lobby.settings[g.id] = sanitizeSettings(g, S.lobby.settings[g.id]);
        this.#ensureGameLoaded(g.id);
        break;
      }
      case 'setSettings': {
        if (!needHost()) return;
        const g = getManifest(S.lobby.gameId);
        S.lobby.settings[g.id] = sanitizeSettings(g, { ...S.lobby.settings[g.id], ...msg.settings });
        break;
      }
      case 'start':
        if (!needHost()) return;
        this.#startGame(from);
        return;
      case 'endGame':
        if (!needHost() || !S.game) return;
        S.game = null;
        this.sys('Back to the lobby.');
        break;
      case 'promote':
        if (!needHost() || !target || target.id === S.hostId) return;
        if (target.promoted == null) {
          target.promoted = S.promoteSeq++;
          this.sys(`${target.name} was promoted to co-host.`);
        }
        break;
      case 'demote':
        if (!needHost() || !target) return;
        if (target.promoted != null) {
          target.promoted = null;
          this.sys(`${target.name} is no longer a co-host.`);
        }
        break;
      case 'kick':
        if (!needHost() || !target || target.id === from) return;
        S.banned.push(target.id);
        this.io.out(target.id, { t: 'kicked' });
        this.remove(target.id, 'was kicked');
        return;
      case 'transfer':
        // Handled by Room (needs network); it calls back into handoff().
        return;
      default:
        return;
    }
    this.changed();
  }

  async #startGame(from) {
    const S = this.S;
    if (S.game) return;
    const manifest = getManifest(S.lobby.gameId);
    let game;
    try {
      game = await loadGame(manifest.id);
    } catch (err) {
      return this.notice(from, `Couldn't load ${manifest.name}: ${err.message}`, 'error');
    }
    if (S.game) return;
    const players = S.members
      .filter((m) => m.connected)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, manifest.maxPlayers ?? Infinity)
      .map((m) => m.id);
    const settings = sanitizeSettings(manifest, S.lobby.settings[manifest.id]);
    const min = minPlayers(manifest, settings);
    if (players.length < min) {
      return this.notice(from, `${manifest.name} needs at least ${min} players.`, 'error');
    }
    S.game = { id: manifest.id, players, settings, state: null, over: false, startedAt: Date.now() };
    try {
      S.game.state = game.logic.setup(this.#ctx(game));
    } catch (err) {
      console.error(err);
      S.game = null;
      return this.notice(from, `Couldn't start: ${err.message}`, 'error');
    }
    this.sys(`${manifest.name} started.`);
    this.changed();
  }

  // ---------------------------------------------------------------- game runner

  #ensureGameLoaded(id) {
    if (!getLoadedGame(id)) {
      loadGame(id)
        .then(() => this.changed())
        .catch((err) => console.error(err));
    }
  }

  #ctx(game) {
    const S = this.S;
    return {
      now: Date.now(),
      random: Math.random,
      players: S.game.players,
      settings: S.game.settings,
      assets: game.assets,
      name: (id) => this.member(id)?.name ?? S.game.names?.[id] ?? 'Someone',
      isConnected: (id) => !!this.member(id)?.connected,
      // Seats a room member in the running game (for games that allow joining mid-game).
      addPlayer: (id) => {
        if (!this.member(id) || S.game.players.includes(id)) return false;
        S.game.players.push(id);
        return true;
      },
      emit: (ev, to = null) => this.events.push({ ev, to }),
    };
  }

  #gameCall(fn, ...args) {
    const S = this.S;
    if (!S.game || S.game.over) return;
    const game = getLoadedGame(S.game.id);
    if (!game || !game.logic[fn]) return;
    // Remember names so the game can still show people who left.
    S.game.names ??= {};
    for (const id of S.game.players) {
      const m = this.member(id);
      if (m) S.game.names[id] = m.name;
    }
    const ctx = this.#ctx(game);
    let result;
    try {
      result = game.logic[fn](S.game.state, ...args, ctx);
    } catch (err) {
      console.error(`[game:${S.game.id}] ${fn} threw`, err);
      return;
    }
    if (S.game.state?.over) S.game.over = true;
    // tick() returns false when nothing changed, to avoid needless broadcasts.
    if (result !== false || this.events.length) this.changed();
  }

  tick() {
    this.#gameCall('tick');
  }

  // ---------------------------------------------------------------- output

  changed() {
    this.snapDirty = true;
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flush();
    });
  }

  publicRoom() {
    const S = this.S;
    return {
      code: S.code,
      epoch: S.epoch,
      hostId: S.hostId,
      members: S.members.map(({ id, name, peerId, seq, promoted, connected }) => ({ id, name, peerId, seq, promoted, connected })),
      lobby: S.lobby,
      chat: S.chat,
      game: S.game ? { id: S.game.id, players: S.game.players, over: S.game.over, settings: S.game.settings } : null,
    };
  }

  flush() {
    const S = this.S;
    const pub = this.publicRoom();
    const game = S.game ? getLoadedGame(S.game.id) : null;
    const events = this.events;
    this.events = [];
    for (const m of S.members) {
      if (!m.connected) continue;
      let view = null;
      if (game && S.game.state) {
        try {
          view = game.logic.view(S.game.state, m.id, this.#ctx(game));
        } catch (err) {
          console.error('[game] view threw', err);
        }
      }
      const key = JSON.stringify([pub, view]);
      if (this.lastSent.get(m.id) !== key) {
        this.lastSent.set(m.id, key);
        this.io.out(m.id, { t: 'state', room: pub, view, now: Date.now() });
      }
      for (const e of events) {
        if (!e.to || (Array.isArray(e.to) ? e.to.includes(m.id) : e.to === m.id)) this.io.out(m.id, { t: 'ev', ev: e.ev });
      }
    }
    this.#snapshotToHeir();
  }

  /** Keeps the next-in-line member supplied with a full backup for seamless migration. */
  #snapshotToHeir(force = false) {
    const heir = heirOf(this.S);
    const now = Date.now();
    if (!heir) return;
    const heirChanged = heir.id !== this.lastHeir;
    if (!heirChanged && !force && (!this.snapDirty || now - this.lastSnapAt < SNAPSHOT_EVERY_MS)) {
      if (this.snapDirty && !this.snapTimer) {
        this.snapTimer = setTimeout(() => {
          this.snapTimer = null;
          this.#snapshotToHeir();
        }, SNAPSHOT_EVERY_MS);
      }
      return;
    }
    this.lastHeir = heir.id;
    this.lastSnapAt = now;
    this.snapDirty = false;
    this.io.out(heir.id, { t: 'snap', s: this.S });
  }

  succession() {
    return succession(this.S);
  }
}
