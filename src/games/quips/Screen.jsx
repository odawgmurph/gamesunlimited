/**
 * The main screen: the big, shared view of the game, meant for a TV or a
 * screen everyone can see. It only shows public information (prompts,
 * anonymous answers, results), never anybody's private prompts. It renders
 * either on the page or, through <Popout>, in a window of its own.
 *
 * Sizes are in container units (cqw), so the same layout scales from a
 * laptop column to a full-screen TV.
 */
import { useRef } from 'preact/hooks';
import './screen.css';

export const COLORS = ['#ff4f8b', '#ffd23f', '#2fd4e8', '#7d6bff', '#ff8a3d', '#4be08a', '#ff5ccf', '#5ab0ff', '#c2f04a', '#ff6b6b', '#b48cff'];

export const colorOf = (view, id) => {
  const i = view.players.findIndex((p) => p.id === id);
  return COLORS[(i < 0 ? 0 : i) % COLORS.length];
};

const pts = (n) => n.toLocaleString('en-US');

function initials(name = '?') {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length > 1 ? w[0][0] + w[1][0] : [...w[0]].slice(0, 2).join('')).toUpperCase();
}

export function Avatar({ name, color, label = true, cls = '', delay = 0, badge }) {
  return (
    <span class={`qps-av ${cls}`} style={{ '--c': color, '--d': `${delay}s` }}>
      <span class="qps-av-dot">
        {initials(name)}
        {badge && <span class="qps-av-badge">{badge}</span>}
      </span>
      {label && <span class="qps-av-name">{name}</span>}
    </span>
  );
}

export function Logo({ small }) {
  return (
    <span class={`qps-logo ${small ? 'small' : ''}`} aria-label="Quips">
      <span class="qps-logo-bubble">Quips</span>
    </span>
  );
}

function TimerRing({ view, now }) {
  if (!view.deadline || (view.phase !== 'answer' && view.phase !== 'vote')) return null;
  const total = view.deadline - view.startedAt;
  const left = Math.max(0, view.deadline - now);
  const secs = Math.ceil(left / 1000);
  const f = total > 0 ? left / total : 0;
  const C = 276.46; // 2πr for r = 44
  return (
    <div class={`qps-timer ${secs <= 10 ? 'low' : ''}`} role="timer" aria-label={`${secs} seconds left`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle class="qps-timer-track" cx="50" cy="50" r="44" />
        <circle class="qps-timer-fill" cx="50" cy="50" r="44" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - f) }} />
      </svg>
      <span>{secs}</span>
    </div>
  );
}

export function PromptCard({ text, cls = '' }) {
  const parts = text.split(/_{3,}/);
  return (
    <div class={`qps-prompt ${cls}`}>
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span class="qps-blank" aria-label="blank" />}
        </span>
      ))}
    </div>
  );
}

const roundTitle = (v) => (v.final ? 'The Last Quip' : `Round ${v.round}`);

/**
 * @param {{ view: any, now: number, code: string, joinHost: string, onFullscreen?: () => void, tools?: any }} props
 */
export function Screen({ view, now, code, joinHost, tools }) {
  const ref = useRef(null);
  const active = view.players.filter((p) => !p.left);
  let body;
  switch (view.phase) {
    case 'answer':
      body = <AnswerScreen view={view} players={active} />;
      break;
    case 'vote':
      body = view.final ? <FinalVoteScreen view={view} /> : <VoteScreen view={view} />;
      break;
    case 'reveal':
      body = view.final ? <FinalRevealScreen view={view} /> : <RevealScreen view={view} />;
      break;
    case 'scores':
      body = <Board view={view} title="Scores" next />;
      break;
    case 'over':
      body = <OverScreen view={view} />;
      break;
    default:
      body = (
        <div class="qps-center">
          <h1 class="qps-title">Waiting for players…</h1>
          <p class="qps-sub">Quips needs at least 3 players here to keep going.</p>
          <div class="qps-crowd">
            {active.map((p) => (
              <Avatar key={p.id} name={p.name} color={colorOf(view, p.id)} cls={p.connected ? '' : 'dim'} />
            ))}
          </div>
        </div>
      );
  }
  return (
    <div class="qps-wrap" ref={ref}>
      <div class="qps" data-phase={view.phase}>
        <div class="qps-bg" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </div>
        <header class="qps-top">
          <Logo />
          {view.phase !== 'over' && view.phase !== 'waiting' && (
            <span class="qps-round">
              {roundTitle(view)}
              {view.multiplier > 1 && <b>×{view.multiplier}</b>}
            </span>
          )}
          <span class="qps-code">
            <small>Join at {joinHost}</small>
            <b>{code}</b>
          </span>
        </header>
        <main class="qps-main" key={`${view.phase}-${view.round}-${view.matchup?.index ?? ''}`}>
          {body}
        </main>
        <TimerRing view={view} now={now} />
        {tools && <div class="qps-tools">{tools}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- phases

function AnswerScreen({ view, players }) {
  const done = players.filter((p) => !p.writing).length;
  return (
    <div class="qps-center">
      <span class="qps-kicker">{view.final ? 'Final round' : roundTitle(view)}</span>
      <h1 class="qps-title qps-splash">{view.final ? 'The Last Quip!' : 'Write your answers!'}</h1>
      <p class="qps-sub">
        {view.final
          ? 'Everyone answers the same prompt. Then everyone gets three votes.'
          : view.multiplier > 1
            ? `Check your device for two prompts. Everything is worth ×${view.multiplier} this round!`
            : 'Check your device: you’ve got two prompts. Be funny. Be quick.'}
      </p>
      <div class="qps-crowd">
        {players.map((p, i) => (
          <Avatar
            key={p.id}
            name={p.name}
            color={colorOf(view, p.id)}
            delay={0.3 + i * 0.07}
            cls={`${p.writing ? 'writing' : 'done'} ${p.connected ? '' : 'dim'}`}
            badge={p.writing ? null : '✓'}
          />
        ))}
      </div>
      <p class="qps-count">
        {done} of {players.length} done
      </p>
    </div>
  );
}

function VoterRow({ view }) {
  const voters = view.players.filter((p) => !p.left && (p.toVote || p.voted));
  return (
    <div class="qps-foot">
      <span class="qps-foot-call">Vote on your device!</span>
      <span class="qps-foot-row">
        {voters.map((p) => (
          <Avatar key={p.id} name={p.name} color={colorOf(view, p.id)} label={false} cls={`sm ${p.voted ? 'done pop' : 'dim'}`} />
        ))}
        {view.voting?.crowdCast > 0 && <span class="qps-crowdnum">+{view.voting.crowdCast} from the audience</span>}
      </span>
    </div>
  );
}

function VoteScreen({ view }) {
  const m = view.matchup;
  return (
    <div class="qps-duel-wrap">
      <PromptCard text={m.prompt} />
      <div class="qps-duel">
        {m.entries.map((e, k) => [
          k === 1 && (
            <span key="vs" class="qps-vs">
              VS
            </span>
          ),
          <div key={e.i} class={`qps-ans side-${k}`} style={{ '--d': `${0.5 + k * 0.6}s` }}>
            <span class="qps-ans-text">{e.text}</span>
          </div>,
        ])}
      </div>
      <VoterRow view={view} />
    </div>
  );
}

function RevealScreen({ view }) {
  const m = view.matchup;
  const r = view.reveal;
  const total = r.entries.reduce((a, e) => a + e.votes, 0);
  const byId = Object.fromEntries(view.players.map((p) => [p.id, p]));
  return (
    <div class="qps-duel-wrap">
      <PromptCard text={m.prompt} cls="settled" />
      <div class="qps-duel">
        {r.entries.map((e, k) => {
          const won = r.winners.includes(e.i);
          const pct = total ? Math.round((e.votes / total) * 100) : 0;
          const card = (
            <div
              key={e.i}
              class={`qps-ans side-${k} revealed ${won ? 'won' : r.winners.length ? 'lost' : ''} ${e.text == null ? 'empty' : ''}`}
              style={{ '--c': colorOf(view, e.pid), '--d': '0s' }}
            >
              <span class="qps-ans-text">{e.text ?? 'No answer'}</span>
              {!r.special && (
                <>
                  <span class="qps-ans-pct" style={{ '--p': pct / 100 }}>
                    <i />
                    <b>{total ? `${pct}%` : 'No votes'}</b>
                  </span>
                  <span class="qps-ans-voters">
                    {e.voterIds.map((id, j) => (
                      <Avatar key={id} name={byId[id]?.name ?? '?'} color={colorOf(view, id)} label={false} cls="xs pop" delay={0.9 + j * 0.12} />
                    ))}
                    {e.crowd > 0 && <span class="qps-crowdnum late">+{e.crowd} crowd</span>}
                  </span>
                </>
              )}
              <span class="qps-ans-author">{e.name}</span>
              <span class="qps-ans-points">+{pts(e.points)}</span>
              {r.crowdPick === e.i && <span class="qps-ribbon">Crowd favourite</span>}
              {r.sweep === e.i && <span class="qps-stamp">Clean sweep!</span>}
            </div>
          );
          if (k === 0) return card;
          return [
            <span key="vs" class="qps-vs">
              VS
            </span>,
            card,
          ];
        })}
      </div>
      {r.special === 'jinx' && <span class="qps-stamp big">Jinx!</span>}
      {r.special === 'forfeit' && <p class="qps-note">{r.entries.find((e) => e.text == null)?.name ?? 'Someone'} didn’t answer. Win by forfeit!</p>}
    </div>
  );
}

function FinalVoteScreen({ view }) {
  const m = view.matchup;
  return (
    <div class="qps-final-wrap">
      <PromptCard text={m.prompt} />
      <div class={`qps-final-grid n${Math.min(m.entries.length, 12)}`}>
        {m.entries.map((e, k) => (
          <div key={e.i} class="qps-ans final" style={{ '--d': `${0.4 + k * 0.15}s` }}>
            <span class="qps-ans-num">{k + 1}</span>
            <span class="qps-ans-text">{e.text}</span>
          </div>
        ))}
      </div>
      <VoterRow view={view} />
    </div>
  );
}

function FinalRevealScreen({ view }) {
  const m = view.matchup;
  const r = view.reveal;
  // Reveal from fewest points to most, so the winner comes last.
  const order = [...r.entries].sort((a, b) => a.points - b.points || a.votes - b.votes).map((e) => e.i);
  const step = 1.5;
  return (
    <div class="qps-final-wrap">
      <PromptCard text={m.prompt} cls="settled" />
      <div class={`qps-final-grid n${Math.min(m.entries.length, 12)}`}>
        {r.entries.map((e, k) => {
          const at = order.indexOf(e.i);
          const won = r.winners.includes(e.i);
          return (
            <div
              key={e.i}
              class={`qps-ans final revealed ${won ? 'won' : ''} ${e.text == null ? 'empty' : ''}`}
              style={{ '--c': colorOf(view, e.pid), '--d': '0s', '--r': `${0.8 + at * step}s` }}
            >
              <span class="qps-ans-num">{k + 1}</span>
              <span class="qps-ans-text">{e.text ?? 'No answer'}</span>
              <span class="qps-ans-author">{e.name}</span>
              <span class="qps-ans-points">
                +{pts(e.points)}
                <small>
                  {e.votes} {e.votes === 1 ? 'vote' : 'votes'}
                </small>
              </span>
              {won && <span class="qps-crown" aria-label="Winner">♛</span>}
              {r.crowdPick === e.i && <span class="qps-ribbon">Crowd favourite</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function Board({ view, title, next, compact }) {
  const ranked = [...view.players].filter((p) => !p.left || p.score > 0).sort((a, b) => b.score - a.score);
  const top = Math.max(1, ranked[0]?.score ?? 0);
  let note = null;
  if (next) note = view.hasFinal && view.round === view.rounds ? 'Up next: the Last Quip' : `Up next: round ${view.round + 1}, worth ×${view.round + 1}`;
  return (
    <div class={`qps-board-wrap ${compact ? 'compact' : ''}`}>
      {title && <h1 class="qps-title">{title}</h1>}
      <ol class="qps-board" style={{ '--n': Math.max(ranked.length, 4) }}>
        {ranked.map((p, i) => (
          <li
            key={p.id}
            style={{
              '--c': colorOf(view, p.id),
              '--w': p.score / top,
              '--w0': view.phase === 'scores' ? Math.max(0, p.score - p.gained) / top : p.score / top,
              '--d': `${0.2 + i * 0.1}s`,
            }}
          >
            <span class="qps-rank">{i + 1}</span>
            <Avatar name={p.name} color={colorOf(view, p.id)} label={false} cls="sm" />
            <span class="qps-board-name">{p.name}</span>
            <span class="qps-board-bar">
              <i />
            </span>
            <span class="qps-board-pts">
              {pts(p.score)}
              {view.phase === 'scores' && p.gained > 0 && <em>+{pts(p.gained)}</em>}
            </span>
          </li>
        ))}
      </ol>
      {note && <p class="qps-sub">{note}</p>}
    </div>
  );
}

function OverScreen({ view }) {
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const topScore = ranked[0]?.score ?? 0;
  const winners = ranked.filter((p) => p.score === topScore && topScore > 0);
  return (
    <div class="qps-over">
      <div class="qps-confetti" aria-hidden="true">
        {Array.from({ length: 36 }, (_, i) => (
          <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--c': COLORS[i % COLORS.length], '--t': `${(i % 9) * 0.35}s`, '--s': `${2.6 + (i % 5) * 0.5}s` }} />
        ))}
      </div>
      <div class="qps-winner">
        <span class="qps-winner-avs">
          {winners.map((p) => (
            <Avatar key={p.id} name={p.name} color={colorOf(view, p.id)} label={false} cls="xl" badge="♛" />
          ))}
        </span>
        <h1 class="qps-title qps-splash">
          {winners.length === 0 ? 'Game over!' : winners.length === 1 ? `${winners[0].name} wins!` : `${winners.map((p) => p.name).join(' & ')} tie!`}
        </h1>
        {topScore > 0 && <p class="qps-sub">{pts(topScore)} points</p>}
      </div>
      <Board view={view} compact />
    </div>
  );
}
