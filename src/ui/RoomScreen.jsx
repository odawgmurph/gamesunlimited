import { useEffect, useMemo, useState } from 'preact/hooks';
import { Room } from '../net/room.js';
import { getClientId, getSavedName } from './identity.js';
import { toast } from './toast.js';
import { Members } from './Members.jsx';
import { Chat } from './Chat.jsx';
import { Lobby } from './Lobby.jsx';
import { GameStage } from './GameStage.jsx';
import { getManifest } from '../core/registry.js';

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
        <div class="card narrow">
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
        <div class="card narrow">
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
        <button class="btn btn-ghost btn-sm" onClick={onExit} title="Leave room">
          ← Leave
        </button>
        <div class="room-code">
          Room
          <button
            class="code-chip"
            title="Copy invite link"
            onClick={() => {
              navigator.clipboard?.writeText(link).then(
                () => toast('Invite link copied!'),
                () => toast(link)
              );
            }}
          >
            {info.code}
          </button>
        </div>
        <div class="topbar-right">
          {status === 'migrating' && <span class="pill pill-warn">Switching host…</span>}
          {isHost && <span class="pill">You're hosting</span>}
        </div>
      </header>

      <div class="room-body">
        <section class="stage">
          {inGame ? <GameStage room={room} info={info} view={room.state.view} isHost={isHost} /> : <Lobby room={room} info={info} isHost={isHost} />}
        </section>
        <aside class="sidebar">
          <Members room={room} info={info} isHost={isHost} />
          {chatHidden ? (
            <div class="card chat-off">Room chat is off while {manifest.name} is running — use the in-game chat.</div>
          ) : (
            <Chat room={room} info={info} />
          )}
        </aside>
      </div>
    </div>
  );
}
