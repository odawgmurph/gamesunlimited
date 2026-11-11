import { listGames, getManifest } from '../core/registry.js';
import { SettingsForm } from './SettingsForm.jsx';

export function Lobby({ room, info, isHost }) {
  const manifest = getManifest(info.lobby.gameId);
  const settings = info.lobby.settings[manifest.id] || {};
  const count = info.members.filter((m) => m.connected !== false).length;
  const enough = count >= manifest.minPlayers;

  return (
    <div class="lobby">
      <div class="card">
        <div class="card-head">
          <h2>Choose a game</h2>
          {!isHost && <span class="muted">The host picks the game</span>}
        </div>
        <div class="game-cards">
          {listGames().map((g) => (
            <button
              key={g.id}
              class={`game-card ${g.id === manifest.id ? 'selected' : ''}`}
              style={{ '--accent': g.color }}
              disabled={!isHost}
              onClick={() => room.command('selectGame', { gameId: g.id })}
            >
              <div class="game-icon">{g.icon}</div>
              <div>
                <h3>{g.name}</h3>
                <p>{g.tagline}</p>
                <small>
                  {g.minPlayers}–{g.maxPlayers} players
                </small>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div class="lobby-grid">
        <div class="card">
          <h3>How to play {manifest.name}</h3>
          <ul class="rules">
            {(manifest.rules || []).map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
        <div class="card">
          <h3>Settings</h3>
          <SettingsForm
            schema={manifest.settings || []}
            values={settings}
            editable={isHost}
            onChange={(patch) => room.command('setSettings', { settings: patch })}
          />
        </div>
      </div>

      <div class="start-bar">
        {isHost ? (
          <>
            <button class="btn btn-primary btn-lg" disabled={!enough} onClick={() => room.command('start')}>
              Start {manifest.name}
            </button>
            {!enough && <span class="muted">Needs at least {manifest.minPlayers} players ({count} here).</span>}
          </>
        ) : (
          <span class="muted">Waiting for the host to start…</span>
        )}
      </div>
    </div>
  );
}
