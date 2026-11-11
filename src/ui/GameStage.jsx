import { useEffect, useMemo, useState } from 'preact/hooks';
import { getLoadedGame, loadGame } from '../core/registry.js';

/**
 * Mounts the running game's View component and gives it a small API:
 *   api.act(action)      send an action to the game's rules on the host
 *   api.now()            host clock (ms) for countdowns
 *   api.onEvent(fn)      subscribe to one-off events the rules emit (sounds, effects); returns unsubscribe
 *   api.me               your member id
 *   api.name(id)         display name for a member id
 */
export function GameStage({ room, info, view, isHost }) {
  const id = info.game.id;
  const [game, setGame] = useState(() => getLoadedGame(id));
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (game?.manifest.id === id) return;
    setGame(getLoadedGame(id));
    loadGame(id).then(setGame, (e) => setErr(e.message));
  }, [id]);

  const names = useMemo(() => Object.fromEntries(info.members.map((m) => [m.id, m.name])), [info.members]);
  const api = useMemo(
    () => ({
      me: room.me,
      act: (a) => room.act(a),
      now: () => room.now(),
      onEvent: (fn) => room.on('event', fn),
      name: (pid) => api.names[pid] ?? view?.names?.[pid] ?? 'Someone',
      names: {},
    }),
    [room]
  );
  api.names = names;

  if (err) return <div class="panel">Couldn't load the game: {err}</div>;
  if (!game || !view) {
    return (
      <div class="panel center">
        <div class="spinner" />
        <p>Loading {game?.manifest.name || 'game'}…</p>
      </div>
    );
  }
  const { View, manifest } = game;
  return (
    <div class="game-stage">
      <div class="game-bar">
        <h1 class="game-title">{manifest.name}</h1>
        {isHost && (
          <span class="game-bar-actions">
            {info.game.over ? (
              <>
                <button class="btn btn-sm" onClick={() => room.command('endGame')}>
                  Back to lobby
                </button>
                <button
                  class="btn btn-primary btn-sm"
                  onClick={() => {
                    room.command('endGame');
                    room.command('start');
                  }}
                >
                  Play again
                </button>
              </>
            ) : (
              <button class="btn btn-sm" onClick={() => confirm('End the game for everyone?') && room.command('endGame')}>
                End game
              </button>
            )}
          </span>
        )}
      </div>
      <View view={view} info={info} api={api} isHost={isHost} />
    </div>
  );
}
