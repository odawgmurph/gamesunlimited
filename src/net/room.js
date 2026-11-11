/**
 * Room: everything one browser needs to take part in a room.
 *
 * Topology is a star: every member keeps one connection to the current host,
 * whose browser runs HostCore (the authoritative game server). Room codes map
 * to a well-known "door" address that the current host holds so newcomers can
 * find it; members also know each other's personal addresses so they can
 * regroup around a new host instantly.
 *
 * Host migration:
 *  - Planned (host clicks "make host" or leaves): the host ships a full state
 *    snapshot to the new host and tells everyone else where to reconnect.
 *  - Unplanned (host tab closes / network dies): members notice the silence,
 *    walk the succession list (host → co-hosts by promotion order → everyone by
 *    seniority) and connect to the first one that answers. The heir already
 *    holds a recent full snapshot, so a running game carries on.
 */
import { Emitter, NetError, randomId } from './emitter.js';
import { createTransport } from './transport.js';
import { HostCore, freshRoomState, rebuildFromPublic, STALE_MS } from '../core/host.js';
import { succession } from '../core/succession.js';
import { loadGame } from '../core/registry.js';

const HOST_TIMEOUT_MS = STALE_MS;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // no I/O to avoid confusion

export const door = (code) => `room-${code.toUpperCase()}`;

export function makeCode(len = 4) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

export class Room extends Emitter {
  /**
   * @param {{ clientId: string, name: string, code?: string }} opts
   *   Omit `code` to create a new room.
   */
  constructor({ clientId, name, code }) {
    super();
    this.me = clientId;
    this.name = name;
    this.code = code ? code.toUpperCase() : null;
    this.state = { status: 'connecting', error: null, isHost: false, room: null, view: null };
    this.offset = 0; // host clock - local clock
    this.core = null;
    this.snapshot = null;
    this.hostConn = null;
    this.lastHostAt = 0;
    this.clientConns = new Map(); // (host) memberId -> conn
    this.migrating = false;
    this.destroyed = false;
    this.aloneSince = null;
  }

  // ---------------------------------------------------------------- public API

  async start() {
    this.transport = createTransport();
    this.peerId = `${this.me}-${randomId(4)}`;
    try {
      await this.transport.open(this.peerId);
    } catch (err) {
      return this.#fail(`Couldn't reach the matchmaking server (${err.message}). Check your connection and try again.`);
    }
    this.transport.on('connection', (conn) => this.#accept(conn));
    this.watchdog = setInterval(() => this.#watch(), 1000);

    if (!this.code) {
      for (let i = 0; i < 20 && !this.destroyed; i++) {
        const code = makeCode();
        if (await this.transport.claim(door(code))) {
          this.code = code;
          this.#becomeHost(freshRoomState(code, this.me, this.name, this.peerId));
          return;
        }
      }
      return this.#fail('Could not allocate a room code. Try again.');
    }

    // Retry for a bit: right after a host change the new host may not have
    // taken over the room code yet.
    const until = Date.now() + 12000;
    let ok = false;
    while (!ok && !this.destroyed && Date.now() < until) {
      ok = await this.#joinVia(door(this.code), { deadline: until - Date.now() });
      if (!ok && !this.destroyed && !this.state.error) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!ok && !this.destroyed) {
      this.#fail(`Room ${this.code} doesn't exist (or its host is unreachable).`);
    }
  }

  /** Room-level command: setName, chat, selectGame, setSettings, start, endGame, promote, demote, kick, transfer. */
  command(cmd, args = {}) {
    if (cmd === 'transfer') return this.transferHost(args.id);
    if (cmd === 'setName') this.name = args.name;
    this.#toHost({ t: 'cmd', cmd, ...args });
  }

  /** Game action, delivered to the current game's logic.action() on the host. */
  act(action) {
    this.#toHost({ t: 'act', action });
  }

  /** Host clock, for countdowns. */
  now() {
    return Date.now() + this.offset;
  }

  /** Leave the room. With keepSeat (tab reload), we stay listed so we can come back. */
  async leave({ keepSeat = false } = {}) {
    if (this.destroyed) return;
    if (this.state.isHost) {
      const next = this.core.succession().find((m) => m.id !== this.me);
      if (next) {
        this.leaving = true;
        if (!keepSeat) this.core.handle(this.me, { t: 'cmd', cmd: 'leave' });
        this.#handoff(next.id);
        await new Promise((r) => setTimeout(r, 300));
      }
    } else {
      this.#toHost({ t: 'cmd', cmd: 'leave' });
      await new Promise((r) => setTimeout(r, 150));
    }
    this.destroy();
  }

  destroy(status = 'closed') {
    if (this.destroyed) return;
    this.destroyed = true;
    clearInterval(this.watchdog);
    clearInterval(this.doorTimer);
    this.core?.destroy();
    this.hostConn?.close();
    for (const c of this.clientConns.values()) c.close();
    this.transport?.destroy();
    this.#set({ status, isHost: false });
  }

  transferHost(memberId) {
    if (!this.state.isHost || memberId === this.me) return;
    const target = this.core.member(memberId);
    if (!target || !target.connected) return;
    this.#handoff(memberId);
  }

  // ---------------------------------------------------------------- internals

  #set(patch) {
    Object.assign(this.state, patch);
    this.emit('change', this.state);
  }

  #fail(error) {
    this.state.error = error;
    this.destroy('error');
  }

  #toHost(msg) {
    if (this.state.isHost) this.core.handle(this.me, msg);
    else this.hostConn?.send(msg);
  }

  /** (host) send to a member; to ourselves it's a local loopback. */
  #out(memberId, msg) {
    if (memberId === this.me) queueMicrotask(() => this.#onHostMessage(msg));
    else this.clientConns.get(memberId)?.send(msg);
  }

  // ---- incoming connections (relevant when we are, or are about to be, host)

  #accept(conn) {
    conn.on('data', (msg) => this.#onIncoming(conn, msg));
    conn.on('close', () => {
      if (conn.memberId && this.clientConns.get(conn.memberId) === conn) {
        this.clientConns.delete(conn.memberId);
        if (this.state.isHost) this.core.disconnected(conn.memberId);
      }
    });
  }

  #onIncoming(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (!this.state.isHost) {
        const healthy = this.hostConn && Date.now() - this.lastHostAt < 3000;
        const hostPeer = healthy ? this.state.room?.members.find((m) => m.id === this.state.room.hostId)?.peerId : null;
        return conn.send({ t: 'not-host', redirect: hostPeer || null });
      }
      const reason = this.core.join(msg.clientId, msg.name, msg.peerId);
      if (reason) {
        conn.send({ t: 'deny', reason });
        return setTimeout(() => conn.close(), 200);
      }
      const old = this.clientConns.get(msg.clientId);
      if (old && old !== conn) old.close();
      conn.memberId = msg.clientId;
      this.clientConns.set(msg.clientId, conn);
      conn.send({ t: 'welcome', code: this.code });
      return;
    }
    if (!this.state.isHost || !conn.memberId || this.clientConns.get(conn.memberId) !== conn) return;
    if (msg.t === 'pong') return this.core.seen(conn.memberId);
    if (msg.t === 'cmd' && msg.cmd === 'transfer') return; // only the host may transfer, locally
    this.core.handle(conn.memberId, msg);
  }

  // ---- being a client

  /**
   * Connect to `target` and say hello. Resolves true once welcomed.
   * Retries while the target says it isn't host yet (it may still be noticing
   * the old host is gone), and follows redirects to a still-alive host.
   */
  async #joinVia(target, { deadline = 9000, redirects = 2 } = {}) {
    const until = Date.now() + deadline;
    let conn;
    try {
      conn = await this.transport.connect(target, { timeout: Math.min(8000, deadline) });
    } catch {
      return false;
    }
    if (this.destroyed) {
      conn.close();
      return false;
    }
    const result = await new Promise((resolve) => {
      let settled = false;
      let retry;
      const hello = () => conn.send({ t: 'hello', clientId: this.me, name: this.name, peerId: this.peerId });
      const finish = (r) => {
        if (settled) return;
        settled = true;
        clearTimeout(retry);
        clearTimeout(giveUp);
        if (r !== true) conn.close();
        resolve(r);
      };
      const giveUp = setTimeout(() => finish(false), Math.max(0, until - Date.now()));
      conn.on('data', (msg) => {
        if (settled) {
          if (this.hostConn === conn) this.#onHostMessage(msg);
          return;
        }
        if (msg.t === 'welcome') {
          if (this.state.isHost) this.#stepDown();
          this.hostConn = conn;
          this.lastHostAt = Date.now();
          if (msg.code) this.code = msg.code;
          conn.on('close', () => {
            if (this.hostConn === conn) this.#hostLost();
          });
          finish(true);
        } else if (msg.t === 'deny') {
          this.#fail(msg.reason);
          finish(false);
        } else if (msg.t === 'not-host') {
          if (msg.redirect && redirects > 0) finish({ redirect: msg.redirect });
          else retry = setTimeout(hello, 700);
        }
      });
      conn.on('close', () => finish(false));
      hello();
    });
    if (result && result.redirect) {
      const left = until - Date.now();
      return left > 500 && this.#joinVia(result.redirect, { deadline: left, redirects: redirects - 1 });
    }
    return result === true;
  }

  #onHostMessage(msg) {
    if (!msg || typeof msg !== 'object') return;
    this.lastHostAt = Date.now();
    switch (msg.t) {
      case 'state': {
        this.offset = msg.now - Date.now();
        const prevGame = this.state.room?.game?.id;
        this.#set({ status: 'connected', room: msg.room, view: msg.view, error: null });
        // Everyone preloads the selected/running game: any of us may have to host it.
        const want = msg.room.game?.id || msg.room.lobby.gameId;
        if (want && want !== prevGame) loadGame(want).catch(() => {});
        break;
      }
      case 'snap':
        this.snapshot = msg.s;
        break;
      case 'ev':
        this.emit('event', msg.ev);
        break;
      case 'notice':
        this.emit('notice', msg);
        break;
      case 'ping':
        this.hostConn?.send({ t: 'pong' });
        break;
      case 'migrate':
        this.#follow(msg.peerId);
        break;
      case 'handoff':
        this.hostConn?.close();
        this.hostConn = null;
        this.#becomeHost(msg.s, { planned: true, lostHost: msg.departing ? msg.s.hostId : null });
        break;
      case 'kicked':
        this.state.error = 'You were removed from the room by the host.';
        this.destroy('kicked');
        break;
    }
  }

  async #follow(peerId) {
    if (this.migrating) return;
    this.migrating = true;
    const old = this.hostConn;
    this.hostConn = null;
    old?.close();
    this.#set({ status: 'migrating' });
    const ok = await this.#joinVia(peerId, { deadline: 8000, redirects: 0 });
    this.migrating = false;
    if (!ok && !this.destroyed && !this.state.isHost) this.#hostLost();
  }

  // ---- watchdog: pings (host) / host liveness (client)

  #watch() {
    if (this.destroyed) return;
    if (this.state.isHost) {
      for (const c of this.clientConns.values()) c.send({ t: 'ping' });
      // Orphan check: if every other member vanished at once, *we* are probably
      // the one who got cut off. Try to rejoin the others.
      const others = this.core.S.members.filter((m) => m.id !== this.me);
      const anyLive = others.some((m) => this.clientConns.has(m.id));
      if (others.length && !anyLive) {
        this.aloneSince ??= Date.now();
        if (Date.now() - this.aloneSince > HOST_TIMEOUT_MS + 3000) {
          this.aloneSince = Date.now() + 30000; // don't retry too often
          this.#rejoinOthers();
        }
      } else this.aloneSince = null;
      return;
    }
    if (this.hostConn && !this.migrating && Date.now() - this.lastHostAt > HOST_TIMEOUT_MS) {
      this.#hostLost();
    }
  }

  async #rejoinOthers() {
    const pub = this.core.publicRoom();
    const candidates = pub.members.filter((m) => m.id !== this.me).sort((a, b) => a.seq - b.seq);
    for (const c of candidates) {
      if (await this.#joinVia(c.peerId, { deadline: 4000, redirects: 0 })) return;
    }
  }

  /** The host went silent. Regroup around the next host in succession. */
  async #hostLost() {
    if (this.migrating || this.destroyed || this.state.isHost) return;
    this.migrating = true;
    const old = this.hostConn;
    this.hostConn = null;
    old?.close();
    const prev = this.state.room;
    if (!prev) {
      this.migrating = false;
      return this.#fail('Lost connection to the room.');
    }
    this.#set({ status: 'migrating' });
    const candidates = succession(prev).filter((m) => m.id !== prev.hostId);
    let done = false;
    for (const c of candidates) {
      if (this.destroyed) return;
      if (c.id === this.me) {
        const snap = this.snapshot && this.snapshot.epoch === prev.epoch ? this.snapshot : null;
        this.#becomeHost(snap || rebuildFromPublic(prev), { lostHost: prev.hostId });
        done = true;
        break;
      }
      if (await this.#joinVia(c.peerId, { deadline: 9000 })) {
        done = true;
        break;
      }
    }
    // Maybe the old host is actually fine and it was just us.
    if (!done && !this.destroyed && (await this.#joinVia(door(this.code), { deadline: 5000 }))) done = true;
    if (!done && !this.destroyed) this.#becomeHost(rebuildFromPublic(prev), { lostHost: prev.hostId });
    this.migrating = false;
  }

  // ---- being the host

  #becomeHost(S, { planned = false, lostHost = null } = {}) {
    if (this.destroyed) return;
    S = structuredClone(S);
    const now = Date.now();
    if (S.hostId !== this.me || S.epoch === undefined) S.epoch = (S.epoch ?? 0) + 1;
    const previousHost = S.hostId;
    S.hostId = this.me;
    for (const m of S.members) m.lastSeen = now;
    const meM = S.members.find((m) => m.id === this.me);
    if (meM) {
      meM.connected = true;
      meM.peerId = this.peerId;
      meM.name = this.name || meM.name;
      meM.promoted = null;
    }
    if (lostHost) {
      const old = S.members.find((m) => m.id === lostHost);
      if (old && old.connected) {
        old.connected = false;
        old.disconnectedAt = now;
      }
    }
    this.core?.destroy();
    this.core = new HostCore(S, { me: this.me, out: (id, msg) => this.#out(id, msg) });
    if (previousHost !== this.me && meM) this.core.sys(`${meM.name} is now the host.`);
    this.snapshot = null;
    this.state.isHost = true;
    this.#set({ isHost: true, status: 'connected' });
    this.#claimDoor();
    this.core.changed();
  }

  /** Keep trying to hold the room-code address so newcomers can find us. */
  #claimDoor() {
    clearInterval(this.doorTimer);
    const attempt = async () => {
      if (!this.state.isHost || this.destroyed) return clearInterval(this.doorTimer);
      try {
        if (await this.transport.claim(door(this.code))) clearInterval(this.doorTimer);
      } catch {}
    };
    attempt();
    this.doorTimer = setInterval(attempt, 3000);
  }

  #stepDown() {
    if (!this.state.isHost) return;
    clearInterval(this.doorTimer);
    this.transport.release(door(this.code));
    this.core.destroy();
    this.core = null;
    for (const c of this.clientConns.values()) c.close();
    this.clientConns.clear();
    this.state.isHost = false;
    this.#set({ isHost: false });
  }

  /** Planned migration: give the room to `memberId`. */
  #handoff(memberId) {
    const target = this.core.member(memberId);
    if (!target) return;
    const S = this.core.S;
    this.#out(memberId, { t: 'handoff', s: S, departing: !!this.leaving });
    for (const [id, conn] of this.clientConns) {
      if (id !== memberId) conn.send({ t: 'migrate', peerId: target.peerId });
    }
    const conns = [...this.clientConns.values()];
    this.state.room = this.core.publicRoom();
    // Step down; the new host will take the door. Give messages time to flush.
    clearInterval(this.doorTimer);
    this.transport.release(door(this.code));
    this.core.destroy();
    this.core = null;
    this.clientConns.clear();
    this.state.isHost = false;
    this.#set({ isHost: false, status: 'migrating' });
    setTimeout(() => conns.forEach((c) => c.close()), 1500);
    if (!this.leaving) {
      this.migrating = true;
      this.#joinVia(target.peerId, { deadline: 9000, redirects: 0 }).then((ok) => {
        this.migrating = false;
        if (!ok && !this.destroyed) this.#hostLost();
      });
    }
  }
}

export { NetError };
