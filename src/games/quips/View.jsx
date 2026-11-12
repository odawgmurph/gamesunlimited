import { useEffect, useState } from 'preact/hooks';
import { sfx } from '../../ui/sfx.js';
import { MAX_ANSWER, FINAL_VOTES } from './logic.js';
import './quips.css';

function useNow(api, active) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => set((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [active]);
  return api.now();
}

const pts = (n) => n.toLocaleString('en-US');
const roundName = (v) => (v.final ? 'The Last Quip' : `Round ${v.round}`);

export function View({ view, api }) {
  const me = view.you;
  const timed = !!view.deadline;
  const now = useNow(api, timed);

  useEffect(
    () =>
      api.onEvent((ev) => {
        if (ev.type === 'round') sfx.bell();
        else if (ev.type === 'answered' && ev.who !== api.me) sfx.card();
        else if (ev.type === 'vote') sfx.alert();
        else if (ev.type === 'voted') sfx.turn();
        else if (ev.type === 'reveal') {
          if (ev.special === 'jinx') sfx.bad();
          else if (ev.winners.includes(api.me)) sfx.win();
          else sfx.good();
        } else if (ev.type === 'over' && ev.winners.includes(api.me)) sfx.win();
      }),
    [api]
  );

  const secs = timed ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : null;
  const total = timed ? view.deadline - view.startedAt : 0;
  const frac = total > 0 ? Math.max(0, Math.min(1, (view.deadline - now) / total)) : 0;
  const nm = (id) => (id === me ? 'you' : view.players.find((p) => p.id === id)?.name ?? api.name(id));
  const showTimer = view.phase === 'answer' || view.phase === 'vote';
  const myTurn = (view.phase === 'answer' && view.tasks?.some((t) => t.answer == null)) || (view.phase === 'vote' && view.voting?.canVote);

  return (
    <div class="qp">
      <Scores view={view} me={me} />

      {view.canJoin && (
        <div class="qp-banner">
          <span>{view.audience ? 'You’re in the audience. You can vote on every prompt.' : 'You’re watching this game.'}</span>
          <button class="btn btn-primary btn-sm" onClick={() => api.act({ type: 'join' })}>
            Join next round
          </button>
        </div>
      )}

      {view.phase !== 'over' && (
        <div class={`qp-status ${myTurn ? 'mine' : ''}`} aria-live="polite">
          <span>
            <strong class="qp-round">{view.phase === 'waiting' ? 'Paused' : roundName(view)}</strong>
            {view.multiplier > 1 && view.phase !== 'waiting' && <span class="qp-mult">×{view.multiplier}</span>}
            <span class="qp-status-text">{statusLine(view, me, nm)}</span>
          </span>
          {showTimer && secs != null && <span class={`qp-secs ${secs <= 5 ? 'low' : ''}`}>{secs}s</span>}
          {showTimer && total > 0 && <span class="qp-bar" style={{ '--f': frac }} />}
        </div>
      )}

      {view.phase === 'waiting' && (
        <div class="qp-stage">
          <p class="muted center">Waiting for at least 3 players to be here before the next round.</p>
        </div>
      )}
      {view.phase === 'answer' && <Answering view={view} api={api} nm={nm} />}
      {view.phase === 'vote' && view.matchup && <Voting view={view} api={api} />}
      {view.phase === 'reveal' && view.matchup && view.reveal && <Reveal view={view} me={me} />}
      {view.phase === 'scores' && <Standings view={view} me={me} title={`After ${roundName(view).toLowerCase()}`} next={nextUp(view)} />}
      {view.phase === 'over' && <GameOver view={view} me={me} />}
    </div>
  );
}

function nextUp(view) {
  if (view.hasFinal && view.round === view.rounds) return 'Next: the Last Quip';
  return `Next: round ${view.round + 1}, worth ×${view.round + 1}`;
}

function statusLine(view, me, nm) {
  const list = (ids) => ids.map(nm).join(', ');
  switch (view.phase) {
    case 'waiting':
      return 'Not enough players';
    case 'answer': {
      if (view.tasks) {
        const left = view.tasks.filter((t) => t.answer == null).length;
        if (left) return view.final ? 'Everyone answers this one' : `${left} ${left === 1 ? 'answer' : 'answers'} to write`;
        if (!view.tasks.length) return 'You’ll get prompts next round';
      }
      return view.waitingOn.length ? `Waiting on ${list(view.waitingOn)}` : 'Everyone’s done';
    }
    case 'vote': {
      const v = view.voting;
      if (v?.canVote) return view.final ? `Spread your ${FINAL_VOTES} votes` : 'Vote for your favourite';
      if (v?.author && !view.final) return 'One of these is yours. Sit tight.';
      if (v?.mine != null) return view.waitingOn.length ? `Voted. Waiting on ${list(view.waitingOn)}` : 'Voted';
      return view.waitingOn.length ? `Waiting on ${list(view.waitingOn)}` : 'Counting votes';
    }
    case 'reveal':
      return view.matchup.total > 1 ? `Prompt ${view.matchup.index} of ${view.matchup.total}` : 'The results';
    case 'scores':
      return 'Scores so far';
    default:
      return '';
  }
}

// ---------------------------------------------------------------- answering

function Answering({ view, api, nm }) {
  const tasks = view.tasks;
  if (!tasks) {
    return (
      <div class="qp-stage">
        <p class="qp-big muted center">The players are writing their answers…</p>
        {view.waitingOn.length > 0 && <Waiting ids={view.waitingOn} nm={nm} />}
      </div>
    );
  }
  const todo = tasks.find((t) => t.answer == null);
  const index = todo ? tasks.indexOf(todo) + 1 : tasks.length;
  return (
    <div class="qp-stage">
      {todo ? (
        <AnswerBox key={`${view.round}-${todo.m}`} task={todo} n={index} of={tasks.length} final={view.final} onSend={(text) => api.act({ type: 'answer', m: todo.m, text })} />
      ) : tasks.length ? (
        <>
          <p class="qp-big center">All done. Nice.</p>
          {view.waitingOn.length > 0 && <Waiting ids={view.waitingOn} nm={nm} />}
        </>
      ) : (
        <p class="qp-big muted center">You joined mid-round, so you’ll get prompts next round. You can still vote.</p>
      )}
      {tasks.some((t) => t.answer != null) && (
        <ul class="qp-done">
          {tasks
            .filter((t) => t.answer != null)
            .map((t) => (
              <li key={t.m}>
                <span class="muted small">{t.prompt}</span>
                <span class="qp-done-answer">{t.answer}</span>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

function AnswerBox({ task, n, of, final, onSend }) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const ok = text.trim().length > 0 && !sent;
  const send = () => {
    if (!ok) return;
    setSent(true);
    onSend(text.trim());
  };
  return (
    <form
      class="qp-answer"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {of > 1 && (
        <p class="eyebrow">
          Prompt {n} of {of}
        </p>
      )}
      {final && <p class="eyebrow">Everyone gets this one</p>}
      <Prompt text={task.prompt} />
      <div class="qp-answer-row">
        <input
          class="qp-input"
          type="text"
          maxLength={MAX_ANSWER}
          value={text}
          autoFocus
          autoComplete="off"
          placeholder="Your answer"
          aria-label={`Your answer to: ${task.prompt}`}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button class="btn btn-primary btn-lg" type="submit" disabled={!ok}>
          Send
        </button>
      </div>
      <span class={`qp-count ${text.length >= MAX_ANSWER - 10 ? 'low' : ''}`}>
        {text.length}/{MAX_ANSWER}
      </span>
    </form>
  );
}

function Waiting({ ids, nm }) {
  return (
    <ul class="qp-waiting" aria-label="Still writing">
      {ids.map((id) => (
        <li key={id}>
          <span class="qp-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {nm(id)}
        </li>
      ))}
    </ul>
  );
}

function Prompt({ text }) {
  const parts = text.split(/_{3,}/);
  return (
    <div class="qp-prompt">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && <span class="qp-blank" aria-label="blank" />}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- voting

function Voting({ view, api }) {
  const v = view.voting;
  const m = view.matchup;
  const [picks, setPicks] = useState([]);
  useEffect(() => setPicks([]), [m.prompt, view.round]);

  if (view.final) {
    const left = FINAL_VOTES - picks.length;
    const cast = v.mine ?? (v.canVote ? picks : []);
    const count = (i) => cast.filter((x) => x === i).length;
    return (
      <div class="qp-stage">
        <Prompt text={m.prompt} />
        <div class="qp-final-grid">
          {m.entries.map((e) => {
            const c = count(e.i);
            const clickable = v.canVote && !e.mine && left > 0;
            return (
              <button
                key={e.i}
                type="button"
                class={`qp-bubble qp-final ${c ? 'picked' : ''} ${e.mine ? 'mine' : ''}`}
                disabled={!clickable}
                onClick={() => clickable && setPicks([...picks, e.i])}
                aria-label={`${e.text}${c ? `, ${c} of your votes` : ''}${e.mine ? ', your answer' : ''}`}
              >
                <span class="qp-bubble-text">{e.text}</span>
                {(c > 0 || e.mine) && (
                  <span class="qp-bubble-foot">
                    {e.mine && <span class="qp-tag">Yours</span>}
                    {c > 0 && <span class="qp-pips">{'●'.repeat(c)}</span>}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {v.canVote && (
          <div class="qp-vote-actions">
            <span class="muted">{left > 0 ? `${left} ${left === 1 ? 'vote' : 'votes'} left` : 'Ready'}</span>
            <button class="btn btn-ghost" disabled={!picks.length} onClick={() => setPicks([])}>
              Start over
            </button>
            <button class="btn btn-primary" disabled={left > 0} onClick={() => api.act({ type: 'vote', picks })}>
              Cast votes
            </button>
          </div>
        )}
        <VoteCount v={v} />
      </div>
    );
  }

  return (
    <div class="qp-stage">
      <Prompt text={m.prompt} />
      <div class="qp-vs">
        {m.entries.map((e, k) => {
          const chosen = v.mine === e.i;
          return [
            k === 1 && (
              <span key="vs" class="qp-vs-mark" aria-hidden="true">
                vs
              </span>
            ),
            <button
              key={e.i}
              type="button"
              class={`qp-bubble side-${k} ${chosen ? 'picked' : ''} ${e.mine ? 'mine' : ''} ${v.canVote ? 'live' : ''}`}
              disabled={!v.canVote}
              aria-pressed={chosen}
              onClick={() => v.canVote && api.act({ type: 'vote', i: e.i })}
            >
              <span class="qp-bubble-text">{e.text}</span>
              {(e.mine || chosen) && <span class="qp-bubble-foot">{e.mine ? <span class="qp-tag">Yours</span> : <span class="qp-tag">Your vote</span>}</span>}
            </button>,
          ];
        })}
      </div>
      <VoteCount v={v} />
    </div>
  );
}

function VoteCount({ v }) {
  return (
    <p class="muted small center">
      {v.cast} {v.cast === 1 ? 'vote' : 'votes'} in{v.crowdCast > 0 && ` · ${v.crowdCast} from the audience`}
      {v.crowd && v.canVote && ' · you’re voting as the audience'}
    </p>
  );
}

// ---------------------------------------------------------------- results

function Reveal({ view, me }) {
  const r = view.reveal;
  const m = view.matchup;
  const final = view.final;
  const ranked = final ? [...r.entries].sort((a, b) => b.points - a.points || b.votes - a.votes) : r.entries;
  let headline = null;
  if (r.special === 'jinx') headline = 'Jinx! Same answer, so nobody scores.';
  else if (r.special === 'forfeit') {
    const missing = r.entries.filter((e) => e.text == null);
    headline = missing.length ? `${missing.map((e) => (e.pid === me ? 'You' : e.name)).join(' and ')} didn’t answer. Win by forfeit.` : 'Win by forfeit.';
  } else if (r.sweep != null) headline = 'Clean sweep!';
  else if (!r.winners.length) headline = 'Dead even.';

  return (
    <div class="qp-stage">
      <Prompt text={m.prompt} />
      {headline && <p class={`qp-headline ${r.special === 'jinx' ? 'bad' : ''}`}>{headline}</p>}
      <div class={final ? 'qp-final-grid' : 'qp-vs'}>
        {ranked.map((e, k) => {
          const won = r.winners.includes(e.i);
          const card = (
            <div key={e.i} class={`qp-bubble ${final ? 'qp-final' : `side-${k}`} ${won ? 'won' : ''} ${e.text == null ? 'empty' : ''} revealed`}>
              <span class="qp-bubble-text">{e.text ?? 'No answer'}</span>
              <span class="qp-by">
                {e.pid === me ? 'You' : e.name}
                {won && <span class="qp-tag win">{r.sweep === e.i ? 'Sweep' : 'Winner'}</span>}
                {r.crowdPick === e.i && <span class="qp-tag crowd">Crowd pick</span>}
              </span>
              <span class="qp-tally">
                <span class="qp-points">+{pts(e.points)}</span>
                {!r.special && (
                  <span class="muted small">
                    {e.votes} {e.votes === 1 ? 'vote' : 'votes'}
                    {e.crowd > 0 && ` · ${e.crowd} from the crowd`}
                  </span>
                )}
              </span>
              {e.voters.length > 0 && (
                <span class="qp-voters">
                  {[...new Set(e.voters)].map((n) => (
                    <span key={n} class="qp-voter">
                      {n}
                      {final && e.voters.filter((x) => x === n).length > 1 && ` ×${e.voters.filter((x) => x === n).length}`}
                    </span>
                  ))}
                </span>
              )}
            </div>
          );
          if (final || k === 0) return card;
          return [
            <span key="vs" class="qp-vs-mark" aria-hidden="true">
              vs
            </span>,
            card,
          ];
        })}
      </div>
    </div>
  );
}

function Scores({ view, me }) {
  const list = view.players.filter((p) => !p.left || p.score > 0);
  return (
    <ul class="qp-scores" aria-label="Scores">
      {list.map((p) => {
        let tag = null;
        if (p.left) tag = 'Left';
        else if (!p.connected) tag = 'Offline';
        else if (view.phase === 'answer' && p.writing) tag = 'Writing';
        else if (view.phase === 'vote' && p.toVote) tag = 'Voting';
        return (
          <li key={p.id} class={`qp-score ${p.id === me ? 'me' : ''} ${p.left || !p.connected ? 'gone' : ''} ${tag === 'Writing' || tag === 'Voting' ? 'busy' : ''}`}>
            <span class="qp-score-name">
              {p.name}
              {p.id === me && <em> (you)</em>}
            </span>
            <span class="qp-score-pts">{pts(p.score)}</span>
            {tag && <span class="qp-score-tag">{tag}</span>}
          </li>
        );
      })}
    </ul>
  );
}

function Standings({ view, me, title, next }) {
  const ranked = [...view.players].filter((p) => !p.left || p.score > 0).sort((a, b) => b.score - a.score);
  return (
    <div class="qp-stage">
      <p class="eyebrow center">{title}</p>
      <ol class="qp-standings">
        {ranked.map((p, i) => (
          <li key={p.id} class={`${p.id === me ? 'me' : ''} ${i === 0 ? 'top' : ''}`}>
            <span class="rule-n">{String(i + 1).padStart(2, '0')}</span>
            <span class="qp-standing-name">
              {p.name}
              {p.left && <span class="muted"> (left)</span>}
            </span>
            {view.phase === 'scores' && p.gained > 0 && <span class="qp-gained">+{pts(p.gained)}</span>}
            <span class="qp-standing-pts">{pts(p.score)}</span>
          </li>
        ))}
      </ol>
      {next && <p class="muted small center">{next}</p>}
    </div>
  );
}

function GameOver({ view, me }) {
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const top = ranked[0]?.score ?? 0;
  const winners = ranked.filter((p) => p.score === top && top > 0);
  const names = winners.map((p) => (p.id === me ? 'You' : p.name));
  let title = 'Game over';
  if (winners.length === 1) title = `${names[0]} ${winners[0].id === me ? 'win' : 'wins'} with ${pts(top)} points!`;
  else if (winners.length > 1) title = `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} tie on ${pts(top)}!`;
  const best = (view.history || []).filter((h) => !h.special && h.winners.length);
  return (
    <div class="card qp-over">
      <p class="eyebrow">Game over</p>
      <h2>{title}</h2>
      <Standings view={view} me={me} title="Final scores" />
      {best.length > 0 && (
        <details class="qp-history">
          <summary>Every winning answer ({best.length})</summary>
          <ol>
            {best.map((h, k) => (
              <li key={k}>
                <span class="muted small">
                  {h.final ? 'Last Quip' : `Round ${h.round}`} · {h.prompt}
                </span>
                {h.winners.map((i) => (
                  <span key={i} class="qp-history-answer">
                    “{h.entries[i].text}” <span class="muted">— {h.entries[i].pid === me ? 'you' : h.entries[i].name}</span>
                  </span>
                ))}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
