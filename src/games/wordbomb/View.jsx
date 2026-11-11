import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../../ui/sfx.js';
import './wordbomb.css';

function Highlight({ text, prompt }) {
  if (!text) return <span class="wb-placeholder">…</span>;
  const i = prompt ? text.toLowerCase().indexOf(prompt) : -1;
  if (i < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + prompt.length)}</mark>
      {text.slice(i + prompt.length)}
    </span>
  );
}

function Hearts({ n, max }) {
  return (
    <span class="wb-hearts" aria-label={`${n} lives`}>
      {Array.from({ length: Math.max(n, max) }, (_, i) => (
        <span key={i} class={i < n ? 'on' : 'off'}>
          ♥
        </span>
      ))}
    </span>
  );
}

function useNow(api, active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 200);
    return () => clearInterval(t);
  }, [active]);
  return api.now();
}

export function View({ view, api }) {
  const me = api.me;
  const myTurn = view.turn === me && !view.over;
  const mine = view.players.find((p) => p.id === me);
  const [text, setText] = useState('');
  const [flash, setFlash] = useState({}); // playerId -> 'good'|'bad'|'boom'
  const [shake, setShake] = useState(false);
  const [boom, setBoom] = useState(0);
  const input = useRef(null);
  const sendTimer = useRef(null);
  const now = useNow(api, view.startsAt > Date.now() - 5000);
  const starting = view.startsAt > now;

  // New turn: clear and focus the box.
  useEffect(() => {
    setText('');
    if (myTurn) {
      sfx.turn();
      setTimeout(() => input.current?.focus(), 0);
    }
  }, [view.turn, view.prompt, myTurn, starting]);

  useEffect(
    () =>
      api.onEvent((ev) => {
        const mark = (who, kind) => {
          setFlash((f) => ({ ...f, [who]: kind }));
          setTimeout(() => setFlash((f) => ({ ...f, [who]: null })), 700);
        };
        if (ev.type === 'reject') {
          mark(ev.who, 'bad');
          if (ev.who === api.me) {
            sfx.bad();
            setShake(true);
            setTimeout(() => setShake(false), 400);
          }
        } else if (ev.type === 'accept') {
          mark(ev.who, 'good');
          ev.gained ? sfx.life() : sfx.good();
        } else if (ev.type === 'boom') {
          mark(ev.who, 'boom');
          setBoom((b) => b + 1);
          sfx.boom();
        } else if (ev.type === 'over') {
          sfx.win();
        }
      }),
    [api]
  );

  const onInput = (e) => {
    const v = e.currentTarget.value.replace(/[^a-zA-Z'-]/g, '').slice(0, 40);
    setText(v);
    clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => api.act({ type: 'type', text: v }), 40);
  };
  const onSubmit = (e) => {
    e.preventDefault();
    if (!myTurn || !text.trim()) return;
    api.act({ type: 'submit', word: text });
  };

  const n = view.players.length;
  const turnIdx = view.players.findIndex((p) => p.id === view.turn);
  const angleOf = (i) => (i / n) * 360 - 90;

  return (
    <div class={`wb ${boom % 2 ? 'wb-shake-a' : boom ? 'wb-shake-b' : ''}`}>
      <div class="wb-arena">
        {view.players.map((p, i) => {
          const a = (angleOf(i) * Math.PI) / 180;
          const style = { left: `${50 + 36 * Math.cos(a)}%`, top: `${50 + 37 * Math.sin(a)}%` };
          const current = p.id === view.turn && !view.over;
          return (
            <div key={p.id} class={`wb-seat ${current ? 'current' : ''} ${p.alive ? '' : 'dead'} ${flash[p.id] ? 'flash-' + flash[p.id] : ''}`} style={n === 1 ? { left: '50%', top: '88%' } : style}>
              <div class="wb-name">
                {p.name}
                {p.id === me && <em> (you)</em>}
              </div>
              <Hearts n={p.lives} max={view.maxLives} />
              <div class="wb-typing">{current ? <Highlight text={p.id === me ? text : view.typing} prompt={view.prompt} /> : view.last?.who === p.id && view.last.type === 'word' ? <span class="wb-lastword">{view.last.word}</span> : null}</div>
            </div>
          );
        })}

        <div class="wb-center">
          {!view.over && turnIdx >= 0 && n > 1 && <div class="wb-arrow" style={{ transform: `rotate(${angleOf(turnIdx) + 90}deg)` }} />}
          <div class={`wb-bomb ${starting ? '' : 'lit'}`} key={boom}>
            <div class="wb-fuse" />
            <div class="wb-prompt">{starting ? Math.ceil((view.startsAt - now) / 1000) : view.prompt?.toUpperCase()}</div>
          </div>
        </div>
      </div>

      {view.over ? (
        <div class="card wb-over">
          <h2>{view.winner ? `${view.players.find((p) => p.id === view.winner)?.name} wins!` : 'Game over'}</h2>
          <table class="wb-stats">
            <thead>
              <tr>
                <th>Player</th>
                <th>Words</th>
                <th>Longest</th>
              </tr>
            </thead>
            <tbody>
              {[...view.players]
                .sort((a, b) => (b.id === view.winner) - (a.id === view.winner) || b.words - a.words)
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.words}</td>
                    <td>{p.longest || '—'}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p class="muted">{view.usedCount} words played.</p>
        </div>
      ) : (
        <form class={`wb-input ${shake ? 'shake' : ''}`} onSubmit={onSubmit}>
          <input
            ref={input}
            name="word"
            value={text}
            onInput={onInput}
            disabled={!myTurn || starting}
            autoComplete="off"
            autoCapitalize="off"
            spellcheck={false}
            placeholder={myTurn ? `A word containing “${view.prompt?.toUpperCase()}”` : mine?.alive === false ? 'You’re out — spectating' : mine ? `Waiting for ${api.name(view.turn)}…` : 'Spectating'}
          />
          <button class="btn btn-primary" disabled={!myTurn || starting}>
            Go
          </button>
        </form>
      )}

      {mine && view.alphabet && !view.over && (
        <div class="wb-alphabet" title="Use all of these letters to gain a life">
          {view.alphabet.split('').map((ch) => (
            <span key={ch} class={mine.letters.includes(ch) ? 'got' : ''}>
              {ch.toUpperCase()}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
