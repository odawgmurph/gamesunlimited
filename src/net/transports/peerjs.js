/**
 * WebRTC transport backed by PeerJS. Signaling goes through a PeerJS server
 * (the free public cloud by default, configurable via VITE_PEER_* env vars or
 * ?peer=host:port URL param); game traffic flows peer-to-peer over data channels.
 */
import { Peer } from 'peerjs';
import { Emitter, NetError } from '../emitter.js';

const PREFIX = 'gamesunlimited-v1-';

// PeerJS's own defaults, plus a few more STUN servers. The PeerJS TURN relay
// is a best-effort public service; configure a real one (see api/ice.js).
const DEFAULT_ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
];

/** ICE servers from the /api/ice function (TURN relays configured on the server). */
async function fetchIce() {
  try {
    const res = await fetch('/api/ice', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data.iceServers) ? data.iceServers : [];
  } catch {
    return []; // offline, dev server without the route, etc.
  }
}

async function iceServers(env) {
  let extra = [];
  if (env.VITE_ICE_SERVERS) {
    try {
      extra = JSON.parse(env.VITE_ICE_SERVERS);
    } catch {
      console.warn('[peerjs] VITE_ICE_SERVERS is not valid JSON; ignoring it');
    }
  }
  const fetched = await fetchIce();
  // Configured relays first; the defaults stay as a fallback.
  return [...extra, ...fetched, ...DEFAULT_ICE];
}

async function peerOptions() {
  const env = import.meta.env || {};
  const opts = { debug: 1 };
  const params = new URLSearchParams(location.search);
  const override = params.get('peer'); // e.g. ?peer=localhost:9000
  if (override) {
    const [host, port] = override.split(':');
    Object.assign(opts, { host, port: Number(port) || 443, path: '/', secure: location.protocol === 'https:' && host !== 'localhost' });
  } else if (env.VITE_PEER_HOST) {
    opts.host = env.VITE_PEER_HOST;
    if (env.VITE_PEER_PORT) opts.port = Number(env.VITE_PEER_PORT);
    if (env.VITE_PEER_PATH) opts.path = env.VITE_PEER_PATH;
    if (env.VITE_PEER_SECURE) opts.secure = env.VITE_PEER_SECURE !== 'false';
  }
  opts.config = { iceServers: await iceServers(env), sdpSemantics: 'unified-plan' };
  return opts;
}

class PeerConn extends Emitter {
  constructor(dc) {
    super();
    this.dc = dc;
    this.remote = dc.peer.startsWith(PREFIX) ? dc.peer.slice(PREFIX.length) : dc.peer;
    this.open = dc.open;
    this.closed = false;
    dc.on('open', () => {
      this.open = true;
      this.emit('open');
    });
    dc.on('data', (d) => this.emit('data', d));
    const close = () => {
      if (this.closed) return;
      this.closed = true;
      this.emit('close');
    };
    dc.on('close', close);
    dc.on('error', close);
    // Data channels sometimes never fire 'close'; watch the ICE state too.
    // 'disconnected' is often a momentary blip (Wi-Fi roaming, a relay
    // hiccup) that recovers on its own, so give it a few seconds.
    let grace = null;
    dc.on('iceStateChanged', (s) => {
      clearTimeout(grace);
      if (s === 'failed' || s === 'closed') close();
      else if (s === 'disconnected') grace = setTimeout(close, 5000);
    });
  }

  send(msg) {
    if (this.closed || !this.dc.open) return;
    try {
      this.dc.send(msg);
    } catch (err) {
      console.warn('[peerjs] send failed', err);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this.dc.close();
    } catch {}
    this.emit('close');
  }
}

function openPeer(id, opts) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(PREFIX + id, opts);
    const onErr = (err) => {
      cleanup();
      peer.destroy();
      if (err.type === 'unavailable-id') reject(new NetError('taken', `id ${id} is taken`));
      else reject(new NetError('network', err.message || String(err)));
    };
    const onOpen = () => {
      cleanup();
      resolve(peer);
    };
    const cleanup = () => {
      peer.off('error', onErr);
      peer.off('open', onOpen);
    };
    peer.on('error', onErr);
    peer.on('open', onOpen);
  });
}

export class PeerJsTransport extends Emitter {
  name = 'peerjs';
  #opts = null;
  #peer = null;
  #aliases = new Map(); // alias -> Peer
  #pending = new Map(); // remote id -> reject fn (for peer-unavailable errors)

  async open(id) {
    this.id = id;
    this.#opts = await peerOptions();
    this.#peer = await openPeer(id, this.#opts);
    this.#wire(this.#peer, true);
    return id;
  }

  #wire(peer, primary) {
    peer.on('connection', (dc) => {
      const conn = new PeerConn(dc);
      const announce = () => this.emit('connection', conn);
      if (dc.open) announce();
      else dc.once('open', announce);
    });
    peer.on('disconnected', () => {
      // Lost the signaling server; existing data channels keep working.
      if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1000);
    });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        for (const [remote, reject] of this.#pending) {
          if (String(err.message).includes(PREFIX + remote)) reject(new NetError('unavailable', `peer ${remote} unavailable`));
        }
      } else if (primary) {
        console.warn('[peerjs]', err.type, err.message);
      }
    });
  }

  async claim(alias) {
    if (this.#aliases.has(alias)) return true;
    try {
      const p = await openPeer(alias, { ...this.#opts, debug: 0 }); // 'taken' is expected while the old host lets go
      this.#aliases.set(alias, p);
      this.#wire(p, false);
      return true;
    } catch (err) {
      if (err.code === 'taken') return false;
      throw err;
    }
  }

  release(alias) {
    this.#aliases.get(alias)?.destroy();
    this.#aliases.delete(alias);
  }

  connect(remote, { timeout = 12000 } = {}) {
    return new Promise((resolve, reject) => {
      const dc = this.#peer.connect(PREFIX + remote, { reliable: true, serialization: 'json' });
      const conn = new PeerConn(dc);
      let done = false;
      const finish = (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.#pending.delete(remote);
        if (err) {
          conn.close();
          reject(err);
        } else resolve(conn);
      };
      const timer = setTimeout(() => finish(new NetError('timeout', `connect to ${remote} timed out`)), timeout);
      dc.on('iceStateChanged', (st) => st === 'failed' && finish(new NetError('timeout', `no network route to ${remote}`)));
      this.#pending.set(remote, finish);
      conn.once('open', () => finish());
      conn.once('close', () => finish(new NetError('unavailable', 'connection closed')));
    });
  }

  destroy() {
    for (const p of this.#aliases.values()) p.destroy();
    this.#aliases.clear();
    this.#peer?.destroy();
  }
}
