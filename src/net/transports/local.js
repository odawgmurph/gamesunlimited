/**
 * In-browser transport over BroadcastChannel. Every tab of the same origin is a
 * "peer". Used for local development and automated tests (?net=local) so the
 * whole multiplayer stack can run without any signaling server.
 */
import { Emitter, NetError, randomId } from '../emitter.js';

const CHANNEL = 'gamesunlimited-local-net';

class LocalConn extends Emitter {
  constructor(transport, cid, side, remote) {
    super();
    this.t = transport;
    this.cid = cid;
    this.side = side; // 'a' = initiator, 'b' = acceptor
    this.remote = remote;
    this.closed = false;
  }
  send(msg) {
    if (this.closed) return;
    this.t._post({ k: 'data', cid: this.cid, to: this.side === 'a' ? 'b' : 'a', data: msg });
  }
  close() {
    if (this.closed) return;
    this._closed();
    this.t._post({ k: 'close', cid: this.cid, to: this.side === 'a' ? 'b' : 'a' });
  }
  _closed() {
    if (this.closed) return;
    this.closed = true;
    this.t._conns.delete(`${this.cid}:${this.side}`);
    this.emit('close');
  }
}

export class LocalTransport extends Emitter {
  name = 'local';
  _conns = new Map();
  #ids = new Set();
  #bc = null;
  #waiters = new Map();

  async open(id) {
    this.id = id;
    this.#bc = new BroadcastChannel(CHANNEL);
    this.#bc.onmessage = (e) => this.#onMessage(e.data);
    this.#ids.add(id);
    addEventListener('pagehide', () => this.destroy());
    return id;
  }

  _post(msg) {
    this.#bc?.postMessage(msg);
  }

  #onMessage(m) {
    switch (m.k) {
      case 'who': // someone asks if an id is owned
        if (this.#ids.has(m.id)) this._post({ k: 'owned', nonce: m.nonce });
        break;
      case 'owned':
      case 'accept':
      case 'nope':
        this.#waiters.get(m.nonce)?.(m);
        break;
      case 'open':
        if (this.#ids.has(m.to)) {
          const conn = new LocalConn(this, m.cid, 'b', m.from);
          this._conns.set(`${m.cid}:b`, conn);
          this._post({ k: 'accept', nonce: m.cid });
          this.emit('connection', conn);
        }
        break;
      case 'data': {
        const c = this._conns.get(`${m.cid}:${m.to}`);
        // Clone + async hop to mimic a real network boundary.
        if (c) queueMicrotask(() => c.emit('data', m.data));
        break;
      }
      case 'close':
        this._conns.get(`${m.cid}:${m.to}`)?._closed();
        break;
    }
  }

  #ask(msg, nonce, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#waiters.delete(nonce);
        resolve(null);
      }, ms);
      this.#waiters.set(nonce, (reply) => {
        clearTimeout(timer);
        this.#waiters.delete(nonce);
        resolve(reply);
      });
      this._post(msg);
    });
  }

  async claim(alias) {
    if (this.#ids.has(alias)) return true;
    const nonce = randomId();
    const reply = await this.#ask({ k: 'who', id: alias, nonce }, nonce, 250);
    if (reply) return false;
    this.#ids.add(alias);
    return true;
  }

  release(alias) {
    this.#ids.delete(alias);
  }

  async connect(remote, { timeout = 1500 } = {}) {
    timeout = Math.min(timeout, 1500); // same-browser peers answer fast or not at all
    const cid = randomId();
    const conn = new LocalConn(this, cid, 'a', remote);
    this._conns.set(`${cid}:a`, conn);
    const reply = await this.#ask({ k: 'open', to: remote, from: this.id, cid }, cid, timeout);
    if (!reply) {
      this._conns.delete(`${cid}:a`);
      throw new NetError('unavailable', `peer ${remote} unavailable`);
    }
    return conn;
  }

  destroy() {
    for (const c of [...this._conns.values()]) c.close();
    this.#ids.clear();
    this.#bc?.close();
    this.#bc = null;
  }
}
