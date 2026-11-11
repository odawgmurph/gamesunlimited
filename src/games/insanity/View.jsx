import { useEffect, useRef, useState } from 'preact/hooks';
import { sfx } from '../../ui/sfx.js';
import { CardText, FilledBlack, plain } from './text.jsx';
import './insanity.css';

function useNow(api, active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
  return api.now();
}

function Brand() {
  return (
    <span class="ci-brand" aria-hidden="true">
      <span class="ci-brand-mark" />
      Cards with Insanity
    </span>
  );
}

export function BlackCard({ black, answers, size = '' }) {
  if (!black) {
    return (
      <div class={`ci-card ci-black ci-empty ${size}`} aria-hidden="true">
        <Brand />
      </div>
    );
  }
  return (
    <div class={`ci-card ci-black ${size}`} role="img" aria-label={plain(black.text)}>
      <div class="ci-text">{answers && answers.length ? <FilledBlack text={black.text} answers={answers} /> : <CardText text={black.text} />}</div>
      <div class="ci-foot">
        <Brand />
        {(black.pick > 1 || black.draw > 0) && (
          <span class="ci-rule">
            {black.draw > 0 && (
              <span>
                Draw <b>{black.draw}</b>
              </span>
            )}
            <span>
              Pick <b>{black.pick}</b>
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

function WhiteCard({ text, blank, onClick, cls = '', badge, children, label }) {
  const body = (
    <>
      {badge != null && <span class="ci-badge">{badge}</span>}
      <div class="ci-text">{blank ? <span class="ci-blank-card">Blank card — write your own</span> : <CardText text={text} />}</div>
      {children}
      <div class="ci-foot">
        <Brand />
      </div>
    </>
  );
  const c = `ci-card ci-white ${cls}`;
  if (onClick) {
    return (
      <div class={c}>
        <button type="button" class="ci-hit" onClick={onClick} aria-label={label || (blank ? 'Blank card' : plain(text))} aria-pressed={cls.includes('sel')} />
        {body}
      </div>
    );
  }
  return <div class={c}>{body}</div>;
}

function CardBack() {
  return (
    <div class="ci-card ci-white ci-back" aria-hidden="true">
      <span class="ci-back-word">
        Cards
        <br />
        with
        <br />
        Insanity
      </span>
    </div>
  );
}

function describe(ev, name) {
  switch (ev.type) {
    case 'joined':
      return `${name(ev.who)} joined the game`;
    case 'away':
      return `${name(ev.who)} is idle and sitting out`;
    case 'reboot':
      return `${name(ev.who)} traded a point for a new hand`;
    case 'reshuffle':
      return 'The white deck ran out and was reshuffled';
    case 'skip':
      return `Round skipped: ${ev.reason.charAt(0).toLowerCase() + ev.reason.slice(1)}`;
    default:
      return null;
  }
}

export function View({ view, api }) {
  const me = view.you;
  const byId = Object.fromEntries(view.players.map((p) => [p.id, p]));
  const nm = (id) => (id === me ? 'You' : byId[id]?.name ?? api.name(id));
  const isCzar = !!me && view.czar === me;
  const pick = view.black?.pick || 1;
  const [sel, setSel] = useState([]); // selected hand refs, in play order
  const [texts, setTexts] = useState({}); // blank ref -> written text
  const [choice, setChoice] = useState(null); // judging: highlighted group index
  const [feed, setFeed] = useState([]);
  const feedId = useRef(0);
  const timed = !!view.deadline;
  const now = useNow(api, timed);

  // Reset local choices whenever the round or phase moves on.
  useEffect(() => {
    setSel([]);
    setChoice(null);
  }, [view.round, view.phase]);
  useEffect(() => {
    if (!view.hand) return;
    const inHand = new Set(view.hand.map((c) => c.r));
    setSel((s) => (s.every((r) => inHand.has(r)) ? s : s.filter((r) => inHand.has(r))));
  }, [view.hand]);

  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  useEffect(
    () =>
      api.onEvent((ev) => {
        const text = describe(ev, (id) => (id === api.me ? 'You' : byIdRef.current[id]?.name ?? api.name(id)));
        if (text) {
          const id = ++feedId.current;
          setFeed((f) => [...f.slice(-2), { id, text }]);
        }
        if (ev.type === 'played') sfx.card();
        else if (ev.type === 'round') ev.czar === api.me ? sfx.bell() : sfx.turn();
        else if (ev.type === 'judge') sfx.alert();
        else if (ev.type === 'win') ev.who === api.me ? sfx.win() : sfx.good();
        else if (ev.type === 'skip' || ev.type === 'away') sfx.bad();
      }),
    [api]
  );

  const act = (a) => api.act(a);
  const secs = timed ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : null;
  const total = timed ? view.deadline - view.startedAt : 0;
  const frac = total > 0 ? Math.max(0, Math.min(1, (view.deadline - now) / total)) : 0;

  const canPlay = view.phase === 'play' && !!me && !isCzar && !view.played && !view.away;
  const blanksReady = sel.every((r) => !r.startsWith('x') || (texts[r] || '').trim());
  const ready = canPlay && sel.length === pick && blanksReady;
  const toggle = (r) => {
    if (!canPlay) return;
    setSel((s) => (s.includes(r) ? s.filter((x) => x !== r) : pick === 1 ? [r] : s.length >= pick ? s : [...s, r]));
  };
  const submit = () => {
    if (!ready) return;
    const t = {};
    for (const r of sel) if (r.startsWith('x')) t[r] = texts[r].trim();
    act({ type: 'play', cards: sel, texts: t });
    setSel([]);
  };

  // What the black card shows: your selection while playing, the highlighted
  // play while judging, the winner afterwards.
  let answers = null;
  if (view.phase === 'play') {
    if (view.played) answers = view.played;
    else if (sel.length) answers = sel.map((r) => (r.startsWith('x') ? (texts[r] || '').trim() || '____' : view.hand.find((c) => c.r === r)?.text ?? ''));
  } else if (view.phase === 'judge' && choice != null) answers = view.table[choice]?.cards;
  else if ((view.phase === 'result' || view.phase === 'over') && view.result?.index != null) answers = view.table?.[view.result.index]?.cards;

  const status = statusLine(view, { me, isCzar, nm, pick, sel });

  return (
    <div class="ci">
      <ScoreStrip view={view} me={me} />

      {view.away && (
        <div class="ci-banner">
          <span>You missed a couple of rounds, so you’re sitting out.</span>
          <button class="btn btn-primary btn-sm" onClick={() => act({ type: 'back' })}>
            I’m back
          </button>
        </div>
      )}
      {view.canJoin && (
        <div class="ci-banner">
          <span>You’re watching this game.</span>
          <button class="btn btn-primary btn-sm" onClick={() => act({ type: 'join' })}>
            Join the game
          </button>
        </div>
      )}

      {view.phase !== 'over' && (
        <div class={`ci-status ${(canPlay && !view.played) || (isCzar && view.phase === 'judge') ? 'mine' : ''}`} aria-live="polite">
          <span>{status}</span>
          {secs != null && <span class={`ci-secs ${secs <= 5 ? 'low' : ''}`}>{secs}s</span>}
          {total > 0 && <span class="ci-bar" style={{ '--f': frac }} />}
        </div>
      )}

      {feed.length > 0 && view.phase !== 'over' && (
        <ul class="ci-feed">
          {feed.map((f) => (
            <li key={f.id}>{f.text}</li>
          ))}
        </ul>
      )}

      {view.phase === 'over' && <GameOver view={view} me={me} nm={nm} />}

      <div class="ci-table">
        <div class="ci-black-wrap">
          <BlackCard black={view.black} answers={answers} size="lg" />
          {view.czar && view.phase !== 'waiting' && (
            <div class="ci-czar-label">
              Card Czar: <strong>{nm(view.czar)}</strong>
            </div>
          )}
        </div>

        <div class="ci-plays">
          {view.phase === 'waiting' && <p class="muted">Waiting for enough players to deal the next round.</p>}

          {view.phase === 'play' && (
            <>
              <div class="ci-plays-head">
                <span>
                  {view.submitted} {view.submitted === 1 ? 'play' : 'plays'} in
                </span>
                {view.waitingOn.length > 0 && <span class="muted small">Waiting on {view.waitingOn.map((id) => (id === me ? 'you' : nm(id))).join(', ')}</span>}
              </div>
              <div class="ci-groups">
                {view.played && (
                  <div class="ci-group mine">
                    {view.played.map((t, i) => (
                      <WhiteCard key={i} text={t} cls="sm" />
                    ))}
                    <span class="ci-group-tag">Your play</span>
                  </div>
                )}
                {Array.from({ length: Math.max(0, view.submitted - (view.played ? 1 : 0)) }, (_, i) => (
                  <div key={i} class="ci-group">
                    <CardBack />
                  </div>
                ))}
              </div>
            </>
          )}

          {(view.phase === 'judge' || view.phase === 'result' || view.phase === 'over') && view.table && (
            <>
              <div class="ci-plays-head">
                <span>{view.phase === 'judge' ? (isCzar ? 'Pick your favourite' : `${nm(view.czar)} is choosing…`) : 'Everyone’s plays'}</span>
                {isCzar && view.phase === 'judge' && (
                  <button class="btn btn-primary btn-sm" disabled={choice == null} onClick={() => act({ type: 'judge', index: choice })}>
                    Pick this one
                  </button>
                )}
              </div>
              <div class="ci-groups" role={isCzar && view.phase === 'judge' ? 'radiogroup' : undefined} aria-label="Plays">
                {view.table.map((g) => {
                  const won = view.result?.index === g.i && view.phase !== 'judge';
                  const chosen = choice === g.i && view.phase === 'judge';
                  return (
                    <div
                      key={g.i}
                      class={`ci-group ${won ? 'won' : ''} ${chosen ? 'chosen' : ''} ${view.phase === 'judge' ? 'live' : ''}`}
                      onMouseEnter={() => view.phase === 'judge' && !isCzar && setChoice(g.i)}
                      onMouseLeave={() => view.phase === 'judge' && !isCzar && setChoice(null)}
                    >
                      {view.phase === 'judge' && (
                        <button
                          type="button"
                          class="ci-hit"
                          role={isCzar ? 'radio' : undefined}
                          aria-checked={isCzar ? chosen : undefined}
                          aria-label={g.cards.map(plain).join(' / ')}
                          onClick={() => setChoice(choice === g.i && !isCzar ? null : g.i)}
                          onDblClick={() => isCzar && act({ type: 'judge', index: g.i })}
                        />
                      )}
                      {g.cards.map((t, i) => (
                        <WhiteCard key={i} text={t} cls="sm" />
                      ))}
                      {g.mine && view.phase === 'judge' && <span class="ci-group-tag">Yours</span>}
                      {g.name && <span class={`ci-group-tag ${won ? 'win' : ''}`}>{won ? `★ ${g.who === me ? 'You' : g.name}` : g.who === me ? 'You' : g.name}</span>}
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {view.phase === 'result' && view.result?.skipped && <p class="muted">{view.result.reason}. Nobody scores; cards go back to their owners.</p>}
        </div>
      </div>

      {view.hand && view.phase !== 'over' && (
        <section class={`ci-hand-wrap ${canPlay ? 'mine' : ''}`} aria-label="Your hand">
          <div class="ci-hand-head">
            <span>
              Your hand
              {isCzar && view.phase === 'play' && <span class="muted"> · you’re the Czar this round</span>}
            </span>
            <span class="ci-hand-actions">
              {view.canReboot && (
                <button class="btn btn-ghost btn-sm" onClick={() => confirm('Trade 1 point for a whole new hand?') && act({ type: 'reboot' })}>
                  New hand (−1 pt)
                </button>
              )}
              {canPlay && (
                <button class="btn btn-primary" disabled={!ready} onClick={submit}>
                  {pick > 1 ? `Play ${sel.length}/${pick}` : 'Play card'}
                </button>
              )}
            </span>
          </div>
          <div class={`ci-hand ${isCzar || view.played || view.phase !== 'play' ? 'idle' : ''}`}>
            {view.hand.map((c) => {
              const at = sel.indexOf(c.r);
              return (
                <WhiteCard
                  key={c.r}
                  text={c.text}
                  blank={c.blank && at < 0}
                  cls={`${at >= 0 ? 'sel' : ''} ${canPlay ? 'pickable' : ''}`}
                  badge={at >= 0 && pick > 1 ? at + 1 : null}
                  onClick={canPlay ? () => toggle(c.r) : undefined}
                >
                  {c.blank && at >= 0 && (
                    <textarea
                      class="ci-write"
                      maxLength={120}
                      rows={4}
                      placeholder="Write your answer"
                      aria-label="Your answer for the blank card"
                      value={texts[c.r] || ''}
                      autoFocus
                      onInput={(e) => setTexts({ ...texts, [c.r]: e.currentTarget.value })}
                      onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
                    />
                  )}
                </WhiteCard>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function statusLine(view, { me, isCzar, nm, pick, sel }) {
  if (view.phase === 'waiting') return 'Need at least 3 players (2 people plus Rando counts) to keep going';
  if (view.phase === 'result') {
    if (view.result?.skipped) return view.result.reason;
    return `${nm(view.result?.winner)} ${view.result?.winner === me ? 'win' : 'wins'} the round. Next round shortly.`;
  }
  if (view.phase === 'judge') return isCzar ? 'Read them out, then pick the funniest' : `${nm(view.czar)} is judging`;
  if (!me) return `Round ${view.round}: ${nm(view.czar)} is the Card Czar`;
  if (isCzar) return 'You’re the Card Czar. Read the card out while everyone plays.';
  if (view.away) return 'You’re sitting out';
  if (view.played) return view.waitingOn.length ? 'Played. Waiting for the others…' : 'Played';
  if (pick > 1) return sel.length < pick ? `Pick ${pick} cards, in order (${sel.length}/${pick})` : 'Ready. Hit Play.';
  return sel.length ? 'Ready. Hit Play.' : 'Pick a card to play';
}

function ScoreStrip({ view, me }) {
  const ranked = view.players.filter((p) => !p.left || p.score > 0);
  return (
    <ul class="ci-scores" aria-label="Scores">
      {ranked.map((p) => {
        const czar = p.id === view.czar && view.phase !== 'waiting' && view.phase !== 'over';
        let tag = null;
        if (p.left) tag = 'Left';
        else if (czar) tag = 'Czar';
        else if (p.away) tag = 'Idle';
        else if (!p.connected) tag = 'Offline';
        else if (view.phase === 'play' && p.played) tag = 'Played';
        return (
          <li key={p.id} class={`ci-score ${p.id === me ? 'me' : ''} ${czar ? 'czar' : ''} ${p.played ? 'done' : ''} ${p.left || p.away || !p.connected ? 'gone' : ''}`}>
            <span class="ci-score-name">
              {p.name}
              {p.id === me && <em> (you)</em>}
            </span>
            <span class="ci-score-pts" title={`${p.score} of ${view.scoreLimit} points`}>
              {p.score}
            </span>
            {tag && <span class="ci-score-tag">{tag}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function GameOver({ view, me, nm }) {
  const standings = [...view.players].sort((a, b) => b.score - a.score);
  const top = standings[0];
  const rando = top?.bot;
  return (
    <div class="card ci-over">
      <p class="eyebrow">Game over</p>
      <h2>{rando ? `${top.name} won. Everyone go home in shame.` : top ? `${top.id === me ? 'You win' : `${top.name} wins`} with ${top.score} ${top.score === 1 ? 'point' : 'points'}!` : 'Game over'}</h2>
      <ol class="ci-standings">
        {standings.map((p, i) => (
          <li key={p.id} class={i === 0 ? 'top' : ''}>
            <span class="rule-n">{String(i + 1).padStart(2, '0')}</span>
            <span class="ci-standing-name">
              {p.name}
              {p.left && <span class="muted"> (left)</span>}
            </span>
            <span class="ci-standing-pts">{p.score}</span>
          </li>
        ))}
      </ol>
      {view.history?.length > 0 && (
        <details class="ci-history">
          <summary>Every winning card ({view.history.length})</summary>
          <ol>
            {view.history.map((h, i) => (
              <li key={i}>
                <span class="ci-history-text">
                  <FilledBlack text={h.black} answers={h.answers} />
                </span>
                <span class="muted small">
                  Round {h.round} · {nm(h.who)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
