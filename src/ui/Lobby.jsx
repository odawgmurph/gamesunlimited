import { listGames, getManifest, minPlayers } from '../core/registry.js';
import { SettingsForm } from './SettingsForm.jsx';

export function Lobby({ room, info, isHost }) {
  const manifest = getManifest(info.lobby.gameId);
  const settings = info.lobby.settings[manifest.id] || {};
  const count = info.members.filter((m) => m.connected !== false).length;
  const min = minPlayers(manifest, settings);
  const enough = count >= min;

  return (
    <div class="lobby">
      <section>
        <div class="section-head">
          <h1>Choose a game</h1>
          {!isHost && <span class="muted small">The host picks the game</span>}
        </div>
        <div class="game-cards">
          {listGames().map((g) => {
            const selected = g.id === manifest.id;
            return (
              <button key={g.id} class={`game-card ${selected ? 'selected' : ''}`} aria-pressed={selected} disabled={!isHost} onClick={() => room.command('selectGame', { gameId: g.id })}>
                <span class="game-card-top">
                  <strong>{g.name}</strong>
                  {selected && (
                    <span class="check" aria-hidden="true">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12l5 5 9-10" />
                      </svg>
                    </span>
                  )}
                </span>
                <span class="game-card-text">{g.tagline}</span>
                <span class="game-card-meta">
                  {g.minPlayers}–{g.maxPlayers} players
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <div class="lobby-grid">
        <section>
          <h2 class="eyebrow">How to play</h2>
          <ol class="rules">
            {(manifest.rules || []).map((r, i) => (
              <li key={i}>
                <span class="rule-n">{String(i + 1).padStart(2, '0')}</span>
                <span>{r}</span>
              </li>
            ))}
          </ol>
        </section>
        <section class="panel settings-panel">
          <h2 class="eyebrow">Settings</h2>
          <SettingsForm
            schema={manifest.settings || []}
            values={settings}
            editable={isHost}
            onChange={(patch) => room.command('setSettings', { settings: patch })}
          />
        </section>
      </div>

      <div class="start-bar">
        {isHost ? (
          <>
            <button class="btn btn-primary btn-tall" disabled={!enough} onClick={() => room.command('start')}>
              Start {manifest.name}
            </button>
            <span class="muted">
              {enough ? `${count} ${count === 1 ? 'player' : 'players'} in the room` : `Needs at least ${min} players (${count} here)`}
            </span>
          </>
        ) : (
          <span class="muted">Waiting for the host to start…</span>
        )}
      </div>
    </div>
  );
}
