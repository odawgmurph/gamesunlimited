import { useEffect, useMemo, useState } from 'preact/hooks';
import { Room } from '../net/room.js';
import { getClientId, getSavedName } from './identity.js';
import { toast } from './toast.js';
import { Members } from './Members.jsx';
import { Chat } from './Chat.jsx';
import { Lobby } from './Lobby.jsx';
import { GameStage } from './GameStage.jsx';
import { getManifest } from '../core/registry.js';
import { ThemeToggle } from './ThemeToggle.jsx';

function useRoom(session, onCode) {
  const room = useMemo(
    () => new Room({ clientId: getClientId(), name: getSavedName(), code: session.code && !session.create ? session.code : undefined }),
    [session.key]
  );
  const [, force] = useState(0);
  useEffect(() => {
    const offChange = room.on('change', () => {
      if (room.code) onCode(room.code);
      force((n) => n + 1);
    });
    const offNotice = room.on('notice', (n) => toast(n.text, n.level));
    if (import.meta.env.DEV) window.__room = room; // handy for debugging in the console
    room.start();
    // Tab closing/reloading: hosts hand the room off right away; everyone keeps
    // their seat for a while in case it was just a reload.
    const bye = () => (room.state.isHost ? room.leave({ keepSeat: true }) : room.destroy());
    addEventListener('pagehide', bye);
    return () => {
      offChange();
      offNotice();
      removeEventListener('pagehide', bye);
      room.leave();
    };
  }, [room]);
  return room;
}

export function RoomScreen({ session, onCode, onExit }) {
  const room = useRoom(session, onCode);
  const { status, error, isHost, room: info } = room.state;

  if (status === 'error' || status === 'kicked' || status === 'closed') {
    return (
      <main class="center-screen">
        <div class="panel narrow">
          <h2>{status === 'kicked' ? 'Removed' : 'Disconnected'}</h2>
          <p>{error || 'You left the room.'}</p>
          <button class="btn btn-primary" onClick={onExit}>
            Back home
          </button>
        </div>
      </main>
    );
  }

  if (!info) {
    return (
      <main class="center-screen">
        <div class="panel narrow">
          <div class="spinner" />
          <p>{session.create ? 'Creating room…' : `Joining ${session.code}…`}</p>
          <button class="btn btn-ghost" onClick={onExit}>
            Cancel
          </button>
        </div>
      </main>
    );
  }

  const inGame = !!info.game;
  const manifest = getManifest(info.game?.id || info.lobby.gameId);
  const chatHidden = inGame && !info.game.over && manifest?.roomChatDuringGame === false;
  const link = `${location.origin}/${info.code}`;

  return (
    <div class="room">
      <header class="topbar">
        <div class="topbar-inner">
          <button class="btn btn-ghost btn-sm leave" onClick={onExit}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
            Leave
          </button>
          <span class="topbar-sep" />
          <div class="room-code">
            <span class="muted">Room</span>
            <span class="code">{info.code}</span>
            <button
              class="btn btn-sm"
              onClick={() => {
                navigator.clipboard?.writeText(link).then(
                  () => toast('Invite link copied'),
                  () => toast(link)
                );
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a1 1 0 0 1 1-1h9" />
              </svg>
              Copy invite link
            </button>
          </div>
          <div class="topbar-right">
            {status === 'migrating' && <span class="pill pill-warn">Switching host…</span>}
            {isHost && <span class="muted small">You're hosting</span>}
            <ThemeToggle />
          </div>
        </div>
      </header>

      <div class="room-body">
        <section class="stage">
          {inGame ? <GameStage room={room} info={info} view={room.state.view} isHost={isHost} /> : <Lobby room={room} info={info} isHost={isHost} />}
        </section>
        <aside class="sidebar">
          <Members room={room} info={info} isHost={isHost} />
          {chatHidden ? (
            <div class="panel chat-off">Room chat is off while {manifest.name} is running — use the in-game chat.</div>
          ) : (
            <Chat room={room} info={info} />
          )}
        </aside>
      </div>
    </div>
  );
}
