import { useEffect, useState } from 'preact/hooks';
import { loadPyx } from './pyx.js';
import { ensureDeck, getCachedDeck, normalizeCode } from './crcast.js';
import { DEFAULT_SETS, MAX_CRCAST } from './decks.js';
import './insanity.css';

const fmt = (n) => n.toLocaleString('en-US');

function usePyx() {
  const [pyx, setPyx] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let live = true;
    loadPyx().then(
      (d) => live && setPyx(d),
      (e) => live && setErr(e.message)
    );
    return () => (live = false);
  }, []);
  return { pyx, err };
}

/**
 * Fetches every CrCast deck in the settings into this browser's cache, on
 * every player's machine, so whoever ends up hosting can start the game.
 */
function useCrCastStatus(codes) {
  const [status, setStatus] = useState({}); // code -> 'ready' | 'loading' | error message
  const key = codes.join(',');
  useEffect(() => {
    let live = true;
    for (const code of codes) {
      if (getCachedDeck(code)) {
        setStatus((s) => (s[code] === 'ready' ? s : { ...s, [code]: 'ready' }));
        continue;
      }
      setStatus((s) => ({ ...s, [code]: 'loading' }));
      ensureDeck(code).then(
        () => live && setStatus((s) => ({ ...s, [code]: 'ready' })),
        (e) => live && setStatus((s) => ({ ...s, [code]: e.message }))
      );
    }
    return () => (live = false);
  }, [key]);
  return status;
}

export function DeckPicker({ value, editable, onChange }) {
  const { pyx, err } = usePyx();
  const sets = value?.sets || [];
  const crcast = value?.crcast || [];
  const status = useCrCastStatus(crcast.map((d) => d.code));
  const [code, setCode] = useState('');
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState('');
  const [open, setOpen] = useState(false);

  const selected = new Set(sets);
  const update = (patch) => onChange({ sets, crcast, ...patch });
  const toggle = (id) => update({ sets: selected.has(id) ? sets.filter((s) => s !== id) : [...sets, id] });

  // Exact totals for the official sets (regional base games share cards).
  let black = 0;
  let white = 0;
  if (pyx) {
    const b = new Set();
    const w = new Set();
    for (const s of pyx.sets) {
      if (!selected.has(s.id)) continue;
      s.b.forEach((i) => b.add(i));
      s.w.forEach((i) => w.add(i));
    }
    black = b.size;
    white = w.size;
  }
  for (const d of crcast) {
    black += d.b;
    white += d.w;
  }

  const add = async (e) => {
    e.preventDefault();
    const c = normalizeCode(code);
    if (!c) return setAddErr('Deck codes are 5 letters or numbers, like 4XK2P.');
    if (crcast.some((d) => d.code === c)) return setAddErr('That deck is already in.');
    if (crcast.length >= MAX_CRCAST) return setAddErr(`Up to ${MAX_CRCAST} imported decks.`);
    setAdding(true);
    setAddErr('');
    try {
      const deck = await ensureDeck(c);
      update({ crcast: [...crcast, { code: c, name: deck.name, b: deck.black.length, w: deck.white.length }] });
      setCode('');
    } catch (e2) {
      setAddErr(e2.message);
    } finally {
      setAdding(false);
    }
  };

  const chosen = pyx ? pyx.sets.filter((s) => selected.has(s.id)) : [];

  return (
    <div class="ci-decks">
      <div class="ci-decks-head">
        <span class="setting-label">
          Decks
          <small>
            {fmt(black)} black · {fmt(white)} white cards
          </small>
        </span>
        {editable && pyx && (
          <button type="button" class="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? 'Done' : 'Edit sets'}
          </button>
        )}
      </div>

      {err && <p class="error">Couldn’t load the card list: {err}</p>}
      {!pyx && !err && <p class="muted small">Loading card sets…</p>}

      {pyx && !open && (
        <ul class="ci-chips" aria-label="Official sets in play">
          {chosen.length ? chosen.map((s) => <li key={s.id}>{s.name}</li>) : <li class="ci-chip-none">No official sets</li>}
        </ul>
      )}

      {pyx && open && (
        <div class="ci-setlist">
          <div class="ci-quick">
            <button type="button" class="btn btn-ghost btn-sm" onClick={() => update({ sets: DEFAULT_SETS })}>
              Base + boxes
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onClick={() => update({ sets: pyx.sets.map((s) => s.id) })}>
              All
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onClick={() => update({ sets: [] })}>
              None
            </button>
          </div>
          {pyx.sets.map((s) => (
            <label key={s.id} class={`ci-set ${selected.has(s.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              <span class="ci-set-name">{s.name}</span>
              <span class="ci-set-count">
                {s.b.length}/{s.w.length}
              </span>
            </label>
          ))}
          <p class="hint">Numbers are black / white cards.</p>
        </div>
      )}

      <div class="ci-crcast">
        <div class="ci-crcast-title">
          <strong>CrCast decks</strong>
          <a class="muted small" href="https://crcast.cc" target="_blank" rel="noopener noreferrer">
            Browse decks ↗
          </a>
        </div>
        {crcast.length > 0 && (
          <ul class="ci-imports">
            {crcast.map((d) => {
              const st = status[d.code];
              return (
                <li key={d.code}>
                  <span class="ci-import-main">
                    <span class="ci-import-name">{d.name}</span>
                    <span class="ci-import-meta">
                      <code>{d.code}</code> · {d.b}/{d.w}
                      {st === 'loading' && <span class="muted"> · loading…</span>}
                      {st && st !== 'ready' && st !== 'loading' && <span class="ci-bad"> · {st}</span>}
                    </span>
                  </span>
                  {editable && (
                    <button type="button" class="btn btn-ghost btn-sm" aria-label={`Remove ${d.name}`} onClick={() => update({ crcast: crcast.filter((x) => x.code !== d.code) })}>
                      Remove
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {editable ? (
          <form class="ci-add" onSubmit={add}>
            <input
              name="crcast"
              value={code}
              maxLength={80}
              placeholder="Deck code"
              aria-label="CrCast deck code"
              autoComplete="off"
              spellcheck={false}
              onInput={(e) => {
                setCode(e.currentTarget.value);
                setAddErr('');
              }}
            />
            <button class="btn" disabled={adding || !code.trim()}>
              {adding ? 'Adding…' : 'Add'}
            </button>
          </form>
        ) : (
          crcast.length === 0 && <p class="muted small">None</p>
        )}
        {addErr && (
          <p class="error" role="alert">
            {addErr}
          </p>
        )}
      </div>
    </div>
  );
}
