import { useState } from 'preact/hooks';
import { getSavedName, saveName } from './identity.js';
import { ThemeToggle } from './ThemeToggle.jsx';

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
      <ThemeToggle class="home-theme" />
      <div class="home-inner">
        <h1 class="logo">
          <span class="logo-mark" aria-hidden="true" />
          Games Unlimited
        </h1>

        <section class="panel home-card">
          <label class="field">
            <span>Your name</span>
            <input
              name="name"
              value={name}
              maxLength={20}
              autoFocus={!name}
              onInput={(e) => {
                setName(e.currentTarget.value);
                setErr('');
              }}
            />
          </label>

          <form class="field" onSubmit={join}>
            <label for="room-code">Room code</label>
            <div class="join-row">
              <input
                id="room-code"
                name="code"
                class="code-input"
                value={code}
                maxLength={4}
                placeholder="ABCD"
                autoFocus={!!name && !!initialCode}
                onInput={(e) => {
                  setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z]/g, ''));
                  setErr('');
                }}
              />
              <button class="btn btn-outline btn-tall" type="submit">
                Join
              </button>
            </div>
          </form>

          <div class="or">or</div>

          <button class="btn btn-primary btn-tall" onClick={() => ready() && onCreate()}>
            Create a room
          </button>
          {err && (
            <p class="error" role="alert">
              {err}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
