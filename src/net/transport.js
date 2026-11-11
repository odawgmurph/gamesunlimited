/**
 * Transport factory. A transport gives the room layer:
 *   open(id)            -> become reachable at `id`
 *   claim(alias)        -> also become reachable at `alias` (the room code). false if taken.
 *   release(alias)
 *   connect(id)         -> Promise<Conn>; rejects with NetError('unavailable'|'timeout')
 *   emits 'connection'  (Conn)
 *   destroy()
 * A Conn has: remote, send(obj), close(), and emits 'data' and 'close'.
 *
 * To add another transport (e.g. a hosted WebSocket relay), implement the same
 * shape and add it here.
 */
import { PeerJsTransport } from './transports/peerjs.js';
import { LocalTransport } from './transports/local.js';

export function createTransport() {
  const which = new URLSearchParams(location.search).get('net') || import.meta.env?.VITE_TRANSPORT || 'peerjs';
  if (which === 'local') return new LocalTransport();
  return new PeerJsTransport();
}
