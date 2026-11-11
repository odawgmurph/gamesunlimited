import { useState } from 'preact/hooks';
import { getSavedName, saveName } from './identity.js';
import { listGames } from '../core/registry.js';

export function Home({ initialCode, onCreate, onJoin }) {
  const [name, setName] = useState(getSavedName());
  const [code, setCode] = useState(initialCode || '');
  const [err, setErr] = useState('');

  const ready = () => {
    const n = name.trim();
    if (!n) {
      setErr('Pick a name first.');
      return false;
    }
    saveName(n.slice(0, 20));
    return true;
  };

  const join = (e) => {
    e.preventDefault();
    const c = code.trim().toUpperCase();
    if (!/^[A-Z]{4}$/.test(c)) return setErr('Room codes are 4 letters.');
    if (ready()) onJoin(c);
  };

  return (
    <main class="home">
      <header class="hero">
        <div class="logo">
          <span class="logo-mark">◆</span> Games Unlimited
        </div>
        <p class="tagline">Party games in your browser. Make a room, share the code, play. No accounts, no installs.</p>
      </header>

      <section class="card home-card">
        <label class="field">
          <span>Your name</span>
          <input
            name="name"
            value={name}
            maxLength={20}
            placeholder="e.g. Sam"
            autoFocus={!name}
            onInput={(e) => {
              setName(e.currentTarget.value);
              setErr('');
            }}
          />
        </label>

        <div class="home-actions">
          <form class="join-form" onSubmit={join}>
            <input
              name="code"
              class="code-input"
              value={code}
              maxLength={4}
              placeholder="CODE"
              autoFocus={!!name && !!initialCode}
              onInput={(e) => {
                setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, ''));
                setErr('');
              }}
            />
            <button class="btn" type="submit">
              Join room
            </button>
          </form>
          <div class="or">or</div>
          <button class="btn btn-primary" onClick={() => ready() && onCreate()}>
            Create a room
          </button>
        </div>
        {err && <p class="error">{err}</p>}
      </section>

      <section class="game-list">
        <h2>Games</h2>
        <div class="game-cards">
          {listGames().map((g) => (
            <div class="game-card static" key={g.id} style={{ '--accent': g.color }}>
              <div class="game-icon">{g.icon}</div>
              <div>
                <h3>{g.name}</h3>
                <p>{g.tagline}</p>
                <small>
                  {g.minPlayers}–{g.maxPlayers} players
                </small>
              </div>
            </div>
          ))}
        </div>
      </section>
      <footer class="foot">
        Rooms run in players' browsers — whoever is hosting acts as the server, and hosting passes on automatically if they leave.
      </footer>
    </main>
  );
}
