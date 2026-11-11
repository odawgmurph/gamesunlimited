import { toasts } from './toast.js';
import { useSignal } from './signal.js';

export function Toasts() {
  const list = useSignal(toasts);
  return (
    <div class="toasts" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`toast toast-${t.level}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
