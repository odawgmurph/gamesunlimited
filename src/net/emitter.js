/** Tiny event emitter used throughout the networking layer. */
export class Emitter {
  #handlers = new Map();

  on(event, fn) {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
    this.#handlers.get(event).add(fn);
    return () => this.off(event, fn);
  }

  once(event, fn) {
    const off = this.on(event, (...args) => {
      off();
      fn(...args);
    });
    return off;
  }

  off(event, fn) {
    this.#handlers.get(event)?.delete(fn);
  }

  emit(event, ...args) {
    for (const fn of [...(this.#handlers.get(event) || [])]) {
      try {
        fn(...args);
      } catch (err) {
        console.error(`[emitter] handler for "${event}" threw`, err);
      }
    }
  }

  removeAllListeners() {
    this.#handlers.clear();
  }
}

export function randomId(len = 12) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export class NetError extends Error {
  /** @param {'unavailable'|'timeout'|'taken'|'network'} code */
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}
