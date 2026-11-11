import { useState } from 'preact/hooks';
import { succession } from '../core/succession.js';
import { saveName } from './identity.js';

export function Members({ room, info, isHost }) {
  const [menu, setMenu] = useState(null);
  const [editing, setEditing] = useState(false);
  const order = succession(info);
  const offline = info.members.filter((m) => m.connected === false);
  const me = info.members.find((m) => m.id === room.me);

  const rename = (e) => {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get('name');
    saveName(String(name).trim().slice(0, 20));
    room.command('setName', { name });
    setEditing(false);
  };

  return (
    <div class="panel members">
      <div class="card-head">
        <h3>
          Players <span class="muted">{order.length}</span>
        </h3>
        {!editing && (
          <button class="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Rename
          </button>
        )}
      </div>
      {editing && (
        <form class="rename" onSubmit={rename}>
          <input name="name" defaultValue={me?.name} maxLength={20} autoFocus />
          <button class="btn btn-sm">Save</button>
        </form>
      )}
      <ol class="member-list">
        {order.map((m, i) => (
          <li key={m.id} class={m.id === room.me ? 'is-me' : ''}>
            <span class="avatar" title={i === 0 ? 'Host' : `#${i} in line to host`}>
              {(m.name || '?').slice(0, 1).toUpperCase()}
            </span>
            <span class="member-name">
              {m.name}
              {m.id === room.me && <em> (you)</em>}
            </span>
            {m.id === info.hostId && <span class="tag">Host</span>}
            {m.promoted != null && m.id !== info.hostId && <span class="tag">Co-host</span>}
            {isHost && m.id !== room.me && (
              <button class="btn btn-ghost btn-sm kebab" aria-label={`Manage ${m.name}`} onClick={() => setMenu(menu === m.id ? null : m.id)}>
                ⋯
              </button>
            )}
            {menu === m.id && (
              <div class="menu" onClick={() => setMenu(null)}>
                {m.promoted == null ? (
                  <button onClick={() => room.command('promote', { id: m.id })}>Promote to co-host</button>
                ) : (
                  <button onClick={() => room.command('demote', { id: m.id })}>Remove co-host</button>
                )}
                <button onClick={() => room.command('transfer', { id: m.id })}>Make host</button>
                <button class="danger" onClick={() => confirm(`Kick ${m.name}?`) && room.command('kick', { id: m.id })}>
                  Kick
                </button>
              </div>
            )}
          </li>
        ))}
        {offline.map((m) => (
          <li key={m.id} class="offline">
            <span class="avatar">{(m.name || '?').slice(0, 1).toUpperCase()}</span>
            <span class="member-name">{m.name}</span>
            <span class="tag">reconnecting…</span>
          </li>
        ))}
      </ol>
      <p class="hint">If the host leaves, hosting passes to co-hosts first, then to whoever has been here longest.</p>
    </div>
  );
}
