import { useEffect, useState } from 'preact/hooks';
import { sfx } from '../../ui/sfx.js';
import { MAX_ANSWER, FINAL_VOTES } from './logic.js';
import { Screen, Board, PromptCard, Avatar, Logo, colorOf } from './Screen.jsx';
import { Popout, openScreenWindow } from './Popout.jsx';
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

// ---------------------------------------------------------------- main screen placement

const MODE_KEY = 'qp.screen';
function savedMode() {
  try {
    const m = sessionStorage.getItem(MODE_KEY);
    return m === 'inline' || m === 'off' ? m : null;
  } catch {
    return null;
  }
}

/**
 * Where this device shows the main screen: 'inline' (on the page), 'popout'
 * (its own window) or 'off'. The host and a dedicated TV device show it by
 * default, and so does anyone on a big screen; phones get just the controller.
 */
function useScreenMode(defaultOn) {
  const [mode, setModeRaw] = useState(() => savedMode() ?? (defaultOn || matchMedia('(min-width: 1000px)').matches ? 'inline' : 'off'));
  const [win, setWin] = useState(null);
  const setMode = (m) => {
    if (m === 'popout') {
      const w = openScreenWindow();
      if (!w) {
        alert('Your browser blocked the pop-out window. Allow pop-ups for this site and try again.');
        return;
      }
      setWin(w);
    } else if (win) {
      const w = win;
      setWin(null);
      if (!w.closed) w.close();
    }
    setModeRaw(m);
    try {
      if (m !== 'popout') sessionStorage.setItem(MODE_KEY, m);
    } catch {}
  };
  // Close the pop-out when the game view goes away.
  useEffect(() => () => win && !win.closed && win.close(), [win]);
  const closed = () => {
    setWin(null);
    setModeRaw('inline');
  };
  return { mode, setMode, win, closed };
}

function fullscreen(el) {
  const target = el?.closest('.qps-wrap') || el;
  if (!target) return;
  const doc = target.ownerDocument;
  if (doc.fullscreenElement) doc.exitFullscreen?.();
  else target.requestFullscreen?.().catch(() => {});
}

export function View({ view, api, info, isHost }) {
  const me = view.you;
  const isTv = !!view.isScreen;
  const { mode, setMode, win, closed } = useScreenMode(isHost || isTv);
  const timed = !!view.deadline;
  const now = useNow(api, timed || view.phase === 'reveal');

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

  const code = info?.code || '';
  const joinHost = location.host;
  const screenTools = (popped) => (
    <>
      <button type="button" class="qps-tool" title="Full screen" aria-label="Full screen" onClick={(e) => fullscreen(e.currentTarget)}>
        ⛶
      </button>
      {popped ? (
        <button type="button" class="qps-tool" onClick={() => setMode('inline')}>
          Put back
        </button>
      ) : (
        <button type="button" class="qps-tool" onClick={() => setMode('popout')}>
          Pop out
        </button>
      )}
    </>
  );
  const screen = (popped) => <Screen view={view} now={now} code={code} joinHost={joinHost} tools={screenTools(popped)} />;
  const showing = mode !== 'off';

  return (
    <div class="qp">
      <div class="qp-screenbar">
        <span class="qp-screenbar-label">Main screen</span>
        <span class="qp-seg" role="group" aria-label="Where to show the main screen">
          <button type="button" aria-pressed={mode === 'inline'} onClick={() => setMode('inline')}>
            On this page
          </button>
          <button type="button" aria-pressed={mode === 'popout'} onClick={() => (mode === 'popout' ? win?.focus() : setMode('popout'))}>
            Pop-out window
          </button>
          {!isTv && (
            <button type="button" aria-pressed={mode === 'off'} onClick={() => setMode('off')}>
              Off
            </button>
          )}
        </span>
      </div>

      {mode === 'inline' && screen(false)}
      {mode === 'popout' && win && (
        <>
          <Popout win={win} onClose={closed}>
            {screen(true)}
          </Popout>
          <div class="qp-popnote">
            <span>The main screen is in its own window. Drag it to your TV or second display.</span>
            <button class="btn btn-sm" onClick={() => win.focus()}>
              Show it
            </button>
            <button class="btn btn-sm" onClick={() => setMode('inline')}>
              Put it back here
            </button>
          </div>
        </>
      )}

      {isTv ? (
        <p class="muted small center">This device is the main screen for this game. It doesn’t play or vote.</p>
      ) : (
        <Controller view={view} api={api} now={now} compact={showing} me={me} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the controller

function Controller({ view, api, now, compact, me }) {
  const timed = !!view.deadline;
  const secs = timed ? Math.max(0, Math.ceil((view.deadline - now) / 1000)) : null;
  const total = timed ? view.deadline - view.startedAt : 0;
  const frac = total > 0 ? Math.max(0, Math.min(1, (view.deadline - now) / total)) : 0;
  const nm = (id) => (id === me ? 'you' : view.players.find((p) => p.id === id)?.name ?? api.name(id));
  const showTimer = view.phase === 'answer' || view.phase === 'vote';
  const myTurn = (view.phase === 'answer' && view.tasks?.some((t) => t.answer == null)) || (view.phase === 'vote' && view.voting?.canVote);
  const meP = view.players.find((p) => p.id === me);

  return (
    <section class={`qp-ctl ${compact ? 'compact' : ''}`} aria-label="Your controller">
      <header class="qp-ctl-top">
        <Logo small />
        {meP && <Avatar name={meP.name} color={colorOf(view, me)} cls="xs" />}
        {meP && <span class="qp-ctl-score">{pts(meP.score)}</span>}
      </header>

      {view.canJoin && (
        <div class="qp-banner">
          <span>{view.audience ? 'You’re in the audience. You can vote on every prompt.' : 'You’re watching this game.'}</span>
          <button class="qp-btn small" onClick={() => api.act({ type: 'join' })}>
            Join next round
          </button>
        </div>
      )}

      {!compact && view.phase !== 'over' && <Scores view={view} me={me} />}

      {view.phase !== 'over' && (
        <div class={`qp-status ${myTurn ? 'mine' : ''}`} aria-live="polite">
          <span>
            <strong class="qp-round">{view.phase === 'waiting' ? 'Paused' : roundName(view)}</strong>
            {view.multiplier > 1 && view.phase !== 'waiting' && <span class="qp-mult">×{view.multiplier}</span>}
            <span class="qp-status-text">{statusLine(view, me, nm)}</span>
          </span>
          {showTimer && secs != null && <span class={`qp-secs ${secs <= 5 ? 'low' : ''}`}>{secs}</span>}
          {showTimer && total > 0 && <span class="qp-bar" style={{ '--f': frac }} />}
        </div>
      )}

      {view.phase === 'waiting' && <p class="qp-big">Waiting for at least 3 players to be here before the next round.</p>}
      {view.phase === 'answer' && <Answering view={view} api={api} nm={nm} />}
      {view.phase === 'vote' && view.matchup && <Voting view={view} api={api} compact={compact} />}
      {view.phase === 'reveal' && view.matchup && view.reveal && (compact ? <Glance view={view} me={me} /> : <Reveal view={view} me={me} />)}
      {view.phase === 'scores' && (compact ? <Glance view={view} me={me} /> : <Board view={view} title={`After ${roundName(view).toLowerCase()}`} next />)}
      {view.phase === 'over' && <GameOver view={view} me={me} />}
    </section>
  );
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

/** What a player sees while the main screen shows the results. */
function Glance({ view, me }) {
  const ranked = [...view.players].sort((a, b) => b.score - a.score);
  const place = ranked.findIndex((p) => p.id === me);
  const mine = view.phase === 'reveal' ? view.reveal.entries.find((e) => e.pid === me) : null;
  return (
    <div class="qp-glance">
      <span class="qp-glance-eyes" aria-hidden="true">
        👀
      </span>
      <p class="qp-big">{view.phase === 'scores' ? 'Scores are up on the main screen' : 'Look at the main screen!'}</p>
      {mine && (
        <p class="qp-glance-pts">
          {mine.points > 0 ? `You got +${pts(mine.points)}` : view.reveal.special === 'jinx' ? 'Jinx! No points this time.' : 'No points this time.'}
        </p>
      )}
      {place >= 0 && view.phase === 'scores' && (
        <p class="qp-glance-pts">
          You’re #{place + 1} with {pts(ranked[place].score)}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- answering

function Answering({ view, api, nm }) {
  const tasks = view.tasks;
  if (!tasks) {
    return (
      <div class="qp-pane">
        <p class="qp-big">The players are writing their answers…</p>
        {view.waitingOn.length > 0 && <Waiting ids={view.waitingOn} nm={nm} />}
      </div>
    );
  }
  const todo = tasks.find((t) => t.answer == null);
  const index = todo ? tasks.indexOf(todo) + 1 : tasks.length;
  return (
    <div class="qp-pane">
      {todo ? (
        <AnswerBox key={`${view.round}-${todo.m}`} task={todo} n={index} of={tasks.length} final={view.final} onSend={(text) => api.act({ type: 'answer', m: todo.m, text })} />
      ) : tasks.length ? (
        <>
          <p class="qp-big">All done. Nice!</p>
          {view.waitingOn.length > 0 && <Waiting ids={view.waitingOn} nm={nm} />}
        </>
      ) : (
        <p class="qp-big">You joined mid-round, so you’ll get prompts next round. You can still vote.</p>
      )}
      {tasks.some((t) => t.answer != null) && (
        <ul class="qp-done">
          {tasks
            .filter((t) => t.answer != null)
            .map((t) => (
              <li key={t.m}>
                <span class="qp-done-prompt">{t.prompt}</span>
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
      {(of > 1 || final) && <p class="qp-kicker">{final ? 'Everyone gets this one' : `Prompt ${n} of ${of}`}</p>}
      <PromptCard text={task.prompt} cls="qp-card" />
      <input
        class="qp-input"
        type="text"
        maxLength={MAX_ANSWER}
        value={text}
        autoFocus
        autoComplete="off"
        enterKeyHint="send"
        placeholder="Type your answer"
        aria-label={`Your answer to: ${task.prompt}`}
        onInput={(e) => setText(e.currentTarget.value)}
      />
      <div class="qp-answer-row">
        <span class={`qp-count ${text.length >= MAX_ANSWER - 10 ? 'low' : ''}`}>
          {text.length}/{MAX_ANSWER}
        </span>
        <button class="qp-btn" type="submit" disabled={!ok}>
          Send
        </button>
      </div>
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

// ---------------------------------------------------------------- voting

function Voting({ view, api, compact }) {
  const v = view.voting;
  const m = view.matchup;
  const [picks, setPicks] = useState([]);
  useEffect(() => setPicks([]), [m.prompt, view.round]);

  if (view.final) {
    const left = FINAL_VOTES - picks.length;
    const cast = v.mine ?? (v.canVote ? picks : []);
    const count = (i) => cast.filter((x) => x === i).length;
    return (
      <div class="qp-pane">
        <PromptCard text={m.prompt} cls={`qp-card ${compact ? 'small' : ''}`} />
        <div class="qp-choices">
          {m.entries.map((e, k) => {
            const c = count(e.i);
            const clickable = v.canVote && !e.mine && left > 0;
            return (
              <button
                key={e.i}
                type="button"
                class={`qp-choice ${c ? 'picked' : ''} ${e.mine ? 'mine' : ''}`}
                disabled={!clickable}
                onClick={() => clickable && setPicks([...picks, e.i])}
                aria-label={`${e.text}${c ? `, ${c} of your votes` : ''}${e.mine ? ', your answer' : ''}`}
              >
                <span class="qp-choice-num">{k + 1}</span>
                <span class="qp-choice-text">{e.text}</span>
                {e.mine && <span class="qp-tag">Yours</span>}
                {c > 0 && <span class="qp-pips">{'●'.repeat(c)}</span>}
              </button>
            );
          })}
        </div>
        {v.canVote && (
          <div class="qp-vote-actions">
            <span>{left > 0 ? `${left} ${left === 1 ? 'vote' : 'votes'} left` : 'Ready!'}</span>
            <button class="qp-btn ghost small" disabled={!picks.length} onClick={() => setPicks([])}>
              Start over
            </button>
            <button class="qp-btn" disabled={left > 0} onClick={() => api.act({ type: 'vote', picks })}>
              Cast votes
            </button>
          </div>
        )}
        <VoteCount v={v} />
      </div>
    );
  }

  return (
    <div class="qp-pane">
      <PromptCard text={m.prompt} cls={`qp-card ${compact ? 'small' : ''}`} />
      {v.author ? (
        <p class="qp-big">That’s your answer up there. Sit tight!</p>
      ) : (
        <div class="qp-choices two">
          {m.entries.map((e, k) => {
            const chosen = v.mine === e.i;
            return (
              <button
                key={e.i}
                type="button"
                class={`qp-choice side-${k} ${chosen ? 'picked' : ''}`}
                disabled={!v.canVote}
                aria-pressed={chosen}
                onClick={() => v.canVote && api.act({ type: 'vote', i: e.i })}
              >
                <span class="qp-choice-text">{e.text}</span>
                {chosen && <span class="qp-tag">Your vote</span>}
              </button>
            );
          })}
        </div>
      )}
      <VoteCount v={v} />
    </div>
  );
}

function VoteCount({ v }) {
  return (
    <p class="qp-small">
      {v.cast} {v.cast === 1 ? 'vote' : 'votes'} in{v.crowdCast > 0 && ` · ${v.crowdCast} from the audience`}
      {v.crowd && v.canVote && ' · you’re voting as the audience'}
    </p>
  );
}

// ---------------------------------------------------------------- results (when there's no main screen)

function Reveal({ view, me }) {
  const r = view.reveal;
  const m = view.matchup;
  const ranked = view.final ? [...r.entries].sort((a, b) => b.points - a.points || b.votes - a.votes) : r.entries;
  let headline = null;
  if (r.special === 'jinx') headline = 'Jinx! Same answer, so nobody scores.';
  else if (r.special === 'forfeit') {
    const missing = r.entries.filter((e) => e.text == null);
    headline = missing.length ? `${missing.map((e) => (e.pid === me ? 'You' : e.name)).join(' and ')} didn’t answer. Win by forfeit.` : 'Win by forfeit.';
  } else if (r.sweep != null) headline = 'Clean sweep!';
  else if (!r.winners.length) headline = 'Dead even.';

  return (
    <div class="qp-pane">
      <PromptCard text={m.prompt} cls="qp-card small" />
      {headline && <p class={`qp-headline ${r.special === 'jinx' ? 'bad' : ''}`}>{headline}</p>}
      <div class="qp-results">
        {ranked.map((e) => {
          const won = r.winners.includes(e.i);
          return (
            <div key={e.i} class={`qp-result ${won ? 'won' : ''}`} style={{ '--c': colorOf(view, e.pid) }}>
              <span class="qp-choice-text">{e.text ?? 'No answer'}</span>
              <span class="qp-by">
                {e.pid === me ? 'You' : e.name}
                {won && <span class="qp-tag win">{r.sweep === e.i ? 'Sweep' : 'Winner'}</span>}
                {r.crowdPick === e.i && <span class="qp-tag">Crowd pick</span>}
              </span>
              <span class="qp-tally">
                <b>+{pts(e.points)}</b>
                {!r.special && (
                  <span>
                    {e.votes} {e.votes === 1 ? 'vote' : 'votes'}
                    {e.voters.length > 0 && `: ${[...new Set(e.voters)].join(', ')}`}
                    {e.crowd > 0 && ` · ${e.crowd} from the crowd`}
                  </span>
                )}
              </span>
            </div>
          );
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
          <li key={p.id} class={`qp-score ${p.id === me ? 'me' : ''} ${p.left || !p.connected ? 'gone' : ''}`} style={{ '--c': colorOf(view, p.id) }}>
            <span class="qp-score-name">{p.name}</span>
            <span class="qp-score-pts">{pts(p.score)}</span>
            {tag && <span class="qp-score-tag">{tag}</span>}
          </li>
        );
      })}
    </ul>
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
    <div class="qp-pane qp-over">
      <p class="qp-kicker">Game over</p>
      <h2 class="qp-title">{title}</h2>
      <Board view={view} compact />
      {best.length > 0 && (
        <details class="qp-history">
          <summary>Every winning answer ({best.length})</summary>
          <ol>
            {best.map((h, k) => (
              <li key={k}>
                <span class="qp-done-prompt">
                  {h.final ? 'Last Quip' : `Round ${h.round}`} · {h.prompt}
                </span>
                {h.winners.map((i) => (
                  <span key={i} class="qp-done-answer">
                    “{h.entries[i].text}” <span class="qp-faint">— {h.entries[i].pid === me ? 'you' : h.entries[i].name}</span>
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
