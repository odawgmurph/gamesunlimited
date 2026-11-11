import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../../ui/sfx.js';
import './single.css';

const COLORS = ['r', 'y', 'g', 'b'];
const COLOR_NAME = { r: 'Red', y: 'Yellow', g: 'Green', b: 'Blue' };
const SHAPE = { r: '●', y: '▲', g: '■', b: '◆' }; // so colors don't rely on hue alone
const VALUE_NAME = { skip: 'Skip', rev: 'Reverse', d2: 'Draw two', wild: 'Wild', w4: 'Wild draw four' };

function cardLabel(card) {
  if (card.c === 'w') return VALUE_NAME[card.v];
  return `${COLOR_NAME[card.c]} ${VALUE_NAME[card.v] || card.v}`;
}

function SkipIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M6 18L18 6" />
    </svg>
  );
}
function ReverseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 9h13l-4-4M20 15H7l4 4" />
    </svg>
  );
}

function TurnIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4.5h-4.5" />
    </svg>
  );
}

function Glyph({ v }) {
  if (v === 'skip') return <SkipIcon />;
  if (v === 'rev') return <ReverseIcon />;
  if (v === 'd2') return '+2';
  if (v === 'w4') return '+4';
  if (v === 'wild') return null;
  return v;
}

/** A card face. Renders as a button when it can be clicked. */
export function Card({ card, size = 'md', onClick, state = '', label }) {
  const wild = card.c === 'w';
  const body = (
    <>
      <span class="sg-corner">
        <Glyph v={card.v} />
      </span>
      <span class="sg-face">
        {wild && <span class="sg-wheel" />}
        <span class="sg-big">
          <Glyph v={card.v} />
        </span>
      </span>
      <span class="sg-corner sg-corner-b" aria-hidden="true">
        {wild ? '✦' : SHAPE[card.c]}
      </span>
    </>
  );
  const cls = `sg-card sg-${card.c} sg-${size} ${/^\d$/.test(card.v) ? 'sg-num' : 'sg-act'} ${state}`;
  if (onClick) {
    return (
      <button type="button" class={cls} onClick={onClick} aria-label={label || cardLabel(card)}>
        {body}
      </button>
    );
  }
  return (
    <div class={cls} role="img" aria-label={label || cardLabel(card)}>
      {body}
    </div>
  );
}

function Back({ size = 'md', count }) {
  return (
    <div class={`sg-card sg-back sg-${size}`} aria-hidden={count == null}>
      <span class="sg-back-mark">S</span>
      {count != null && <span class="sg-count">{count}</span>}
    </div>
  );
}

function useNow(api, active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
  return api.now();
}

/** The next seat in the current direction, skipping players who left. */
function nextSeat(players, fromId, dir) {
  const n = players.length;
  const from = players.findIndex((p) => p.id === fromId);
  if (from < 0) return null;
  for (let k = 1; k <= n; k++) {
    const p = players[(((from + dir * k) % n) + n) % n];
    if (!p.out) return p;
  }
  return null;
}

function describe(ev, name) {
  switch (ev.type) {
    case 'play': {
      const c = ev.card;
      const col = COLOR_NAME[ev.color];
      if (c.v === 'wild') return `${name(ev.who)} played a Wild — ${col}`;
      if (c.v === 'w4') return `${name(ev.who)} played Wild +4 — ${col}`;
      return null; // the pile shows it
    }
    case 'draw':
      return ev.forced ? `${name(ev.who)} draws ${ev.n}` : null;
    case 'skipped':
      return `${name(ev.who)} is skipped`;
    case 'single':
      return `${name(ev.who)} called Single!`;
    case 'caught':
      return `${name(ev.by)} caught ${name(ev.who)} — +${ev.n}`;
    case 'timeout':
      return `${name(ev.who)} ran out of time`;
    case 'reshuffle':
      return 'Shuffled the pile into a new deck';
    default:
      return null;
  }
}

export function View({ view, api }) {
  const me = view.you;
  const hand = view.hand;
  const myTurn = !!me && view.turn === me && view.phase === 'play';
  const players = view.players;
  const playing = players.filter((p) => !p.out);
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  const mine = me ? byId[me] : null;
  const [picking, setPicking] = useState(null); // wild card id waiting for a color
  const [feed, setFeed] = useState([]);
  const [flash, setFlash] = useState({});
  const feedId = useRef(0);
  const now = useNow(api, !!view.turnEndsAt || view.phase === 'roundEnd');

  useEffect(() => setPicking(null), [view.turn, view.phase]);
  useEffect(() => {
    if (myTurn) sfx.turn();
  }, [myTurn, view.turnStartedAt]);

  useEffect(
    () =>
      api.onEvent((ev) => {
        const mark = (who, kind) => {
          setFlash((f) => ({ ...f, [who]: kind }));
          setTimeout(() => setFlash((f) => ({ ...f, [who]: null })), 900);
        };
        const text = describe(ev, api.name);
        if (text) {
          const id = ++feedId.current;
          setFeed((f) => [...f.slice(-3), { id, text }]);
        }
        if (ev.type === 'play') sfx.card();
        else if (ev.type === 'draw') {
          sfx.draw();
          if (ev.forced) mark(ev.who, 'hit');
        } else if (ev.type === 'single') {
          sfx.alert();
          mark(ev.who, 'single');
        } else if (ev.type === 'caught') {
          ev.who === api.me ? sfx.bad() : sfx.good();
          mark(ev.who, 'hit');
        } else if (ev.type === 'skipped') mark(ev.who, 'hit');
        else if (ev.type === 'round' || ev.type === 'over') sfx.win();
      }),
    [api]
  );

  const act = (a) => api.act(a);
  const playable = new Set(view.playable);
  const onCard = (c) => {
    if (!playable.has(c.id)) return;
    if (c.c === 'w') setPicking(c.id);
    else act({ type: 'play', id: c.id });
  };
  const pickColor = (color) => {
    act({ type: 'play', id: picking, color });
    setPicking(null);
  };

  // Opponents are listed in seat order starting after you.
  const myIdx = players.findIndex((p) => p.id === me);
  const others = myIdx < 0 ? players : [...players.slice(myIdx + 1), ...players.slice(0, myIdx)].filter((p) => p.id !== me);
  const next = view.phase === 'play' ? nextSeat(players, view.turn, view.dir) : null;
  const secs = view.turnEndsAt ? Math.max(0, Math.ceil((view.turnEndsAt - now) / 1000)) : null;
  const total = view.turnEndsAt ? view.turnEndsAt - view.turnStartedAt : 0;
  const frac = total > 0 ? Math.max(0, Math.min(1, (view.turnEndsAt - now) / total)) : 0;
  const vulnerable = view.vulnerable && byId[view.vulnerable];
  const canCall = !!mine && view.phase === 'play' && hand.length <= 2 && !mine.called;
  const canCatch = !!mine && vulnerable && view.vulnerable !== me;
  const turnName = view.turn === me ? 'You' : api.name(view.turn);

  let status;
  if (view.phase !== 'play') status = null;
  else if (myTurn && view.pending) status = playable.size ? `Stack a draw card, or take ${view.pending}` : `Take ${view.pending} cards`;
  else if (myTurn && view.drawnId != null) status = 'Play the card you drew, or keep it';
  else if (myTurn) status = playable.size ? 'Your turn — play a card or draw' : 'Your turn — nothing matches, draw a card';
  else status = `${turnName}’s turn${view.pending ? ` · ${view.pending} cards pending` : ''}`;

  return (
    <div class="sg">
      <div class="sg-seats">
        {others.map((p) => {
          const current = p.id === view.turn && view.phase === 'play';
          return (
            <div key={p.id} class={`sg-seat ${current ? 'current' : ''} ${p.out ? 'out' : ''} ${flash[p.id] ? 'flash-' + flash[p.id] : ''}`}>
              <div class="sg-seat-top">
                <span class="sg-seat-name">{p.name}</span>
                {view.target > 0 && <span class="sg-seat-score">{p.score}</span>}
              </div>
              <div class="sg-seat-cards">
                {p.out ? (
                  <span class="muted small">{p.left ? 'Left' : 'Out'}</span>
                ) : (
                  <>
                    <span class="sg-fan" aria-hidden="true">
                      {Array.from({ length: Math.min(p.count, 6) }, (_, i) => (
                        <span key={i} style={{ '--i': i }} />
                      ))}
                    </span>
                    <span class="sg-seat-count">
                      {p.count} {p.count === 1 ? 'card' : 'cards'}
                    </span>
                  </>
                )}
              </div>
              {p.count === 1 && p.called && !p.out && <span class="sg-badge">Single!</span>}
              {current && view.turnEndsAt > 0 && <span class="sg-seat-timer" style={{ '--f': frac }} />}
            </div>
          );
        })}
      </div>

      <div class={`sg-table sg-ring-${view.color || 'none'}`}>
        <div class="sg-piles">
          <button type="button" class={`sg-pile ${myTurn && view.drawnId == null ? 'live' : ''}`} onClick={() => myTurn && view.drawnId == null && act({ type: 'draw' })} disabled={!myTurn || view.drawnId != null} aria-label={view.pending && myTurn ? `Take ${view.pending} cards` : `Draw a card (${view.drawCount} left)`}>
            <Back size="lg" />
            <span class="sg-pile-label">{view.drawCount} left</span>
          </button>
          <div class="sg-pile">
            {view.top && <Card key={view.top.id} card={view.top} size="lg" state="sg-landed" />}
            <span class="sg-pile-label">
              <span class={`sg-dot sg-${view.color}`} /> {COLOR_NAME[view.color]}
            </span>
          </div>
        </div>
        <div class="sg-table-info">
          {view.pending > 0 && <div class="sg-pending">+{view.pending}</div>}
          <div class={`sg-dir ${view.dir < 0 ? 'ccw' : ''}`} title={view.dir > 0 ? 'Play passes forward' : 'Play is reversed'}>
            <TurnIcon />
          </div>
          {next && <div class="muted small">Next: {next.id === me ? 'you' : next.name}</div>}
        </div>
      </div>

      {view.phase === 'play' && (
        <div class={`sg-status ${myTurn ? 'mine' : ''}`}>
          <span>{status}</span>
          {secs != null && <span class={`sg-secs ${secs <= 5 ? 'low' : ''}`}>{secs}s</span>}
          {total > 0 && <span class="sg-bar" style={{ '--f': frac }} />}
        </div>
      )}

      {feed.length > 0 && view.phase === 'play' && (
        <ul class="sg-feed" aria-live="polite">
          {feed.map((f) => (
            <li key={f.id}>{f.text}</li>
          ))}
        </ul>
      )}

      {view.phase === 'play' && (canCall || canCatch || (myTurn && (view.drawnId != null || view.pending > 0))) && (
        <div class="sg-actions">
          {canCall && (
            <button class={`btn sg-call ${hand.length === 1 ? 'urgent' : ''}`} onClick={() => act({ type: 'single' })}>
              Single!
            </button>
          )}
          {canCatch && (
            <button class="btn sg-catch" onClick={() => act({ type: 'catch' })}>
              Catch {vulnerable.name}!
            </button>
          )}
          {myTurn && view.pending > 0 && (
            <button class="btn" onClick={() => act({ type: 'draw' })}>
              Take {view.pending}
            </button>
          )}
          {myTurn && view.drawnId != null && (
            <button class="btn" onClick={() => act({ type: 'pass' })}>
              Keep it &amp; pass
            </button>
          )}
        </div>
      )}

      {picking != null && (
        <div class="sg-picker" role="dialog" aria-label="Choose a color">
          <span>Choose a color</span>
          <div class="sg-picker-row">
            {COLORS.map((c) => (
              <button key={c} class={`sg-swatch sg-${c}`} onClick={() => pickColor(c)} aria-label={COLOR_NAME[c]}>
                {SHAPE[c]}
              </button>
            ))}
          </div>
          <button class="btn btn-ghost btn-sm" onClick={() => setPicking(null)}>
            Cancel
          </button>
        </div>
      )}

      {view.phase === 'play' &&
        (hand ? (
          <div class={`sg-hand-wrap ${myTurn ? 'mine' : ''}`}>
            <div class="sg-hand-head">
              <span>
                Your hand · {hand.length} {hand.length === 1 ? 'card' : 'cards'}
              </span>
              {view.target > 0 && <span class="muted">{mine.score} pts</span>}
            </div>
            <div class="sg-hand">
              {hand.map((c) => {
                const ok = playable.has(c.id);
                const st = `${ok ? 'playable' : myTurn ? 'dim' : ''} ${c.id === view.drawnId ? 'drawn' : ''} ${c.id === picking ? 'picked' : ''}`;
                return <Card key={c.id} card={c} onClick={ok ? () => onCard(c) : undefined} state={st} />;
              })}
            </div>
          </div>
        ) : (
          <p class="muted center">Spectating</p>
        ))}

      {view.phase !== 'play' && <Results view={view} api={api} now={now} />}
    </div>
  );
}

function Results({ view, api, now }) {
  const r = view.roundResult || { winner: view.winner, points: 0, hands: [] };
  const winner = view.over ? view.winner : r.winner;
  const name = (id) => (id === view.you ? 'You' : api.name(id));
  const standings = [...view.players].sort((a, b) => b.score - a.score || b.wins - a.wins);
  const left = Math.max(0, Math.ceil((view.nextRoundAt - now) / 1000));
  return (
    <div class="card sg-results">
      <h2>{view.over ? (winner ? `${name(winner)} ${winner === view.you ? 'win' : 'wins'} the game!` : 'Game over') : `${name(r.winner)} ${r.winner === view.you ? 'win' : 'wins'} hand ${view.round}`}</h2>
      <p class="muted">
        {r.hands.length === 0 ? 'Everyone else left.' : `+${r.points} points from the cards left in other hands`}
        {!view.over && ` · next hand in ${left}s`}
      </p>
      <div class="sg-leftovers">
        {r.hands
          .filter((h) => h.id !== r.winner)
          .map((h) => (
            <div key={h.id} class="sg-leftover">
              <div class="sg-leftover-head">
                <strong>{name(h.id)}</strong>
                <span class="muted">{h.points} pts</span>
              </div>
              <div class="sg-mini-row">
                {h.cards.length ? h.cards.map((c) => <Card key={c.id} card={c} size="sm" />) : <span class="muted small">No cards</span>}
              </div>
            </div>
          ))}
      </div>
      {view.target > 0 && (
        <table class="sg-scores">
          <thead>
            <tr>
              <th>Player</th>
              <th>Hands won</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((p) => (
              <tr key={p.id} class={p.id === winner ? 'top' : ''}>
                <td>
                  {p.name}
                  {p.left && <span class="muted"> (left)</span>}
                </td>
                <td>{p.wins}</td>
                <td>
                  {p.score} <span class="muted">/ {view.target}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
