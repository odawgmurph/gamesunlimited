import { useEffect, useState } from 'preact/hooks';
import { Home } from './Home.jsx';
import { RoomScreen } from './RoomScreen.jsx';
import { Toasts } from './Toasts.jsx';
import { getSavedName, getTabRoom, setTabRoom } from './identity.js';

const CODE_RE = /^\/([A-Za-z]{4})\/?$/;

function codeFromPath() {
  const m = location.pathname.match(CODE_RE);
  return m ? m[1].toUpperCase() : null;
}

/** Navigate while keeping query params like ?net=local or ?peer=host:port. */
export function navigate(path, replace = false) {
  const url = path + location.search;
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  dispatchEvent(new PopStateEvent('popstate'));
}

export function App() {
  const [code, setCode] = useState(codeFromPath());
  // `session` describes the room we're in: { code } to join, { create: true } to create.
  // A reload of a room tab rejoins straight away (same per-tab identity → same seat).
  const [session, setSession] = useState(() =>
    code && getTabRoom() === code && getSavedName() ? { code, key: Date.now() } : null
  );

  useEffect(() => {
    const onPop = () => setCode(codeFromPath());
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);

  // Leaving the room URL (back button) leaves the room.
  useEffect(() => {
    if (!code && session && !session.create) setSession(null);
    if (session?.create && session.code && !code) setSession(null);
  }, [code]);

  let screen;
  if (session) {
    screen = (
      <RoomScreen
        key={session.key}
        session={session}
        onCode={(c) => {
          session.code = c;
          setTabRoom(c);
          if (codeFromPath() !== c) navigate('/' + c, true);
        }}
        onExit={() => {
          setTabRoom(null);
          setSession(null);
          navigate('/');
        }}
      />
    );
  } else {
    screen = (
      <Home
        initialCode={code}
        onCreate={() => setSession({ create: true, key: Date.now() })}
        onJoin={(c) => {
          if (codeFromPath() !== c) navigate('/' + c);
          setSession({ code: c, key: Date.now() });
        }}
      />
    );
  }
  return (
    <>
      {screen}
      <Toasts />
    </>
  );
}
