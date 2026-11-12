import { useEffect, useState } from 'preact/hooks';
import { parsePrompts, MAX_CUSTOM, MAX_PROMPT } from './custom.js';
import './quips.css';

/**
 * The "Your own prompts" lobby setting: a textarea, one prompt per line.
 * Edits are sent when the box loses focus (or after a pause) so typing doesn't
 * broadcast the lobby on every keystroke.
 */
export function PromptEditor({ value, values, editable, onChange }) {
  const [draft, setDraft] = useState(value || '');
  // The built-in list is big, so it's only fetched for its count.
  const [builtIn, setBuiltIn] = useState(null);
  useEffect(() => {
    let live = true;
    import('./prompts.js').then((m) => live && setBuiltIn(m.PROMPTS.length));
    return () => (live = false);
  }, []);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value || '');
  }, [value, focused]);
  useEffect(() => {
    if (!editable || draft === (value || '')) return;
    const t = setTimeout(() => onChange(draft), 800);
    return () => clearTimeout(t);
  }, [draft]);

  const count = Math.min(parsePrompts(draft).length, MAX_CUSTOM);
  return (
    <div class="qp-editor">
      <div class="qp-editor-head">
        <span class="setting-label">
          Your own prompts
          <small>
            One per line. Use ____ for a blank and {'{player}'} for a random player’s name.{' '}
            {values?.builtIn === false ? 'Built-in prompts are off, so add enough for everyone.' : builtIn ? `Mixed in with ${builtIn} built-in prompts.` : ''}
          </small>
        </span>
        <span class="qp-editor-count">{count}</span>
      </div>
      {editable ? (
        <textarea
          class="qp-editor-box"
          rows={5}
          placeholder={'The worst thing to say on a first date\nA terrible name for a pet goldfish: ____'}
          value={draft}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (draft !== (value || '')) onChange(draft);
          }}
          onInput={(e) => setDraft(e.currentTarget.value)}
          aria-label="Your own prompts, one per line"
          maxLength={(MAX_PROMPT + 1) * (MAX_CUSTOM + 20)}
        />
      ) : count ? (
        <p class="muted small qp-editor-ro">The host added {count === 1 ? '1 prompt' : `${count} prompts`}.</p>
      ) : (
        <p class="muted small qp-editor-ro">The host hasn’t added any prompts.</p>
      )}
    </div>
  );
}
