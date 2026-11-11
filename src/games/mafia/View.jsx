import { useEffect, useRef, useState } from 'preact/hooks';
import { ROLES, TEAM_LABEL, ACTION_LABEL } from './roles.js';
import { sfx } from '../../ui/sfx.js';
import './mafia.css';

const CH_LABEL = { town: 'Town', mafia: 'Mafia', dead: 'Graveyard' };
const PHASE_LABEL = { intro: 'Getting ready', night: 'Night', day: 'Day', verdict: 'Dusk', over: 'Game over' };

function useClock(api) {
  const [, set] = useState(0);
  useEffect(() => {
    const t = setInterval(() => set((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  return api.now();
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function RoleCard({ role, big, bullets }) {
  const r = ROLES[role];
  if (!r) return null;
  return (
    <div class={`mf-role team-${r.team} ${big ? 'big' : ''}`}>
      <div>
        <div class="mf-role-name">
          You are {/^[AEIOU]/.test(r.name) ? 'an' : 'a'} <b>{r.name}</b> <span class={`tag tag-${r.team}`}>{TEAM_LABEL[r.team]}</span>
        </div>
        <div class="mf-role-blurb">{r.blurb}</div>
        {role === 'vigilante' && <div class="mf-role-blurb">Bullets left: {bullets}</div>}
      </div>
    </div>
  );
}

function Chat({ view, api }) {
  const { read, write } = view.channels;
  const [tab, setTab] = useState(read[0]);
  const [text, setText] = useState('');
  const log = useRef(null);
  const msgs = view.chat.filter((m) => m.ch === tab);
  // Unread counters for the tabs you're not looking at.
  const seen = useRef({});
  const lastId = msgs.at(-1)?.id ?? 0;
  seen.current[tab] = Math.max(seen.current[tab] ?? 0, lastId);
  const unread = (c) => view.chat.filter((m) => m.ch === c && m.id > (seen.current[c] ?? 0)).length;
  const canWrite = write.includes(tab) ? tab : null;

  // Follow the channel you can talk in (e.g. mafia at night, town by day).
  useEffect(() => {
    if (!read.includes(tab)) setTab(read[0]);
    else if (write.length && !write.includes(tab)) setTab(write[0]);
  }, [write.join(), read.join()]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [msgs.length, tab]);

  const send = (e) => {
    e.preventDefault();
    if (!text.trim() || !canWrite) return;
    api.act({ type: 'chat', ch: canWrite, text });
    setText('');
  };

  return (
    <div class="card mf-chat">
      <div class="mf-tabs">
        {read.map((c) => (
          <button key={c} class={`mf-tab ch-${c} ${tab === c ? 'on' : ''}`} onClick={() => setTab(c)}>
            {CH_LABEL[c]}
            {c !== tab && unread(c) > 0 && <span class="mf-unread">{unread(c)}</span>}
          </button>
        ))}
      </div>
      <div class="mf-log" ref={log}>
        {msgs.map((m) =>
          m.sys ? (
            <div key={m.id} class={`mf-sys ${m.to ? 'private' : ''} ch-${m.ch}`}>
              {m.text}
            </div>
          ) : (
            <div key={m.id} class={`mf-msg ch-${m.ch}`}>
              <b>{api.name(m.from)}</b> {m.text}
            </div>
          )
        )}
      </div>
      <form class="chat-form" onSubmit={send}>
        <input
          name="mafia-chat"
          value={text}
          maxLength={400}
          disabled={!canWrite}
          placeholder={canWrite ? `Message ${CH_LABEL[canWrite]}…` : view.phase === 'night' ? 'Shh… it’s night.' : 'You can’t talk here right now.'}
          onInput={(e) => setText(e.currentTarget.value)}
        />
        <button class="btn btn-outline" disabled={!canWrite}>
          Send
        </button>
      </form>
    </div>
  );
}

export function View({ view, api }) {
  const now = useClock(api);
  const me = view.me;
  const left = view.phaseEndsAt - now;

  useEffect(
    () =>
      api.onEvent((ev) => {
        if (ev.type === 'death') sfx.bad();
        if (ev.type === 'phase') sfx.bell();
        if (ev.type === 'over') sfx.win();
      }),
    [api]
  );

  const tally = {};
  for (const t of Object.values(view.votes)) tally[t] = (tally[t] || 0) + 1;
  const myVote = me ? view.votes[me.id] : undefined;
  const alive = view.players.filter((p) => p.alive);
  const canVote = view.phase === 'day' && me?.alive;
  const action = view.action;

  const theme = view.phase === 'night' ? 'night' : view.phase === 'over' ? 'over' : 'day';

  return (
    <div class={`mf mf-${theme}`}>
      <div class="mf-banner">
        <div>
          <div class="mf-phase">
            {view.phase === 'day' ? `Day ${view.day}` : PHASE_LABEL[view.phase]}
          </div>
          <div class="muted">
            {alive.length} alive
            {view.phase === 'day' && ` · ${view.majority} votes needed`}
          </div>
        </div>
        {!view.over && <div class="mf-timer">{fmt(left)}</div>}
      </div>

      {view.over && (
        <div class={`card mf-result team-${view.winner}`}>
          <h2>{view.winner === 'town' ? 'Town wins' : 'Mafia wins'}</h2>
          {view.jesterWinners.length > 0 && <p>Jester win: {view.jesterWinners.map(api.name).join(', ')}</p>}
        </div>
      )}

      {me && view.phase === 'intro' && <RoleCard role={me.role} big bullets={me.bullets} />}
      {me && view.phase !== 'intro' && !view.over && (
        <details class="mf-role-wrap" open={!me.alive ? false : undefined}>
          <summary>
            {me.alive ? 'Your role: ' : 'You died. You can watch and talk in the Graveyard. You were: '}
            {ROLES[me.role].name}
          </summary>
          <RoleCard role={me.role} bullets={me.bullets} />
        </details>
      )}
      {!me && <div class="card muted">You’re spectating this game.</div>}

      <div class="mf-grid">
        <div class="card mf-players">
          {action && (
            <div class="mf-action">
              <b>{ACTION_LABEL[action.kind]}</b>
              {action.choice && (
                <span class="muted">
                  {' '}
                  — {action.choice === 'skip' ? 'skipping' : api.name(action.choice)}
                </span>
              )}
            </div>
          )}
          {canVote && <div class="mf-action">Vote to execute someone. Click again to take your vote back.</div>}
          <ul>
            {view.players.map((p) => {
              const r = p.role && ROLES[p.role];
              const isTarget = action?.targets.includes(p.id);
              const teamPicks = action?.team?.filter((m) => m.choice === p.id).map((m) => api.name(m.id));
              return (
                <li key={p.id} class={`${p.alive ? '' : 'dead'} ${p.id === me?.id ? 'me' : ''}`}>
                  <span class="mf-pname">
                    {p.name}
                    {p.id === me?.id && <em> (you)</em>}
                    {!p.connected && p.alive && <em> (offline)</em>}
                    {!p.alive && <em> (dead)</em>}
                  </span>
                  {r && (
                    <span class={`mf-prole team-${r.team}`} title={r.name}>
                      {r.name}
                    </span>
                  )}
                  {teamPicks?.length > 0 && <span class="mf-picks">Picked by {teamPicks.join(', ')}</span>}
                  {view.phase === 'day' && tally[p.id] > 0 && <span class="mf-votes">{tally[p.id]}</span>}
                  {canVote && p.alive && (
                    <button class={`btn btn-sm ${myVote === p.id ? 'btn-primary' : 'btn-outline'}`} onClick={() => api.act({ type: 'vote', target: myVote === p.id ? null : p.id })}>
                      {myVote === p.id ? 'Voted' : 'Vote'}
                    </button>
                  )}
                  {isTarget && (
                    <button class={`btn btn-sm ${action.choice === p.id ? 'btn-primary' : ''}`} onClick={() => api.act({ type: 'night', target: action.choice === p.id ? null : p.id })}>
                      {action.choice === p.id ? 'Chosen' : { kill: 'Kill', protect: 'Protect', investigate: 'Check', shoot: 'Shoot' }[action.kind]}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {canVote && (
            <div class="mf-skip">
              <button class={`btn btn-sm ${myVote === 'skip' ? 'btn-primary' : ''}`} onClick={() => api.act({ type: 'vote', target: myVote === 'skip' ? null : 'skip' })}>
                {myVote === 'skip' ? 'Voted no execution' : 'Vote no execution'}
              </button>
              {tally.skip > 0 && <span class="mf-votes">{tally.skip}</span>}
            </div>
          )}
          {action && (
            <div class="mf-skip">
              <button class={`btn btn-sm ${action.choice === 'skip' ? 'btn-primary' : ''}`} onClick={() => api.act({ type: 'night', target: action.choice === 'skip' ? null : 'skip' })}>
                {action.choice === 'skip' ? 'Skipping tonight' : 'Do nothing tonight'}
              </button>
            </div>
          )}
        </div>
        <Chat view={view} api={api} />
      </div>
    </div>
  );
}
