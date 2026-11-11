import { useEffect, useState } from 'preact/hooks';

/** Minimal observable value + hook. */
export function signal(value) {
  const subs = new Set();
  return {
    get: () => value,
    set(v) {
      value = v;
      subs.forEach((fn) => fn(v));
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

export function useSignal(sig) {
  const [, force] = useState(0);
  useEffect(() => sig.subscribe(() => force((n) => n + 1)), [sig]);
  return sig.get();
}
