import { signal } from './signal.js';

export const toasts = signal([]);
let seq = 0;

export function toast(text, level = 'info', ms = 3500) {
  const id = ++seq;
  toasts.set([...toasts.get(), { id, text, level }]);
  setTimeout(() => toasts.set(toasts.get().filter((t) => t.id !== id)), ms);
}
