/** A fake host context for driving game logic in Node. */
export function makeCtx({ players, settings, assets = {}, seed = 1 }) {
  let s = seed;
  const events = [];
  const ctx = {
    now: 1_000_000,
    random: () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646,
    players,
    settings,
    assets,
    name: (id) => `name-${id}`,
    isConnected: () => true,
    emit: (ev, to) => events.push({ ev, to }),
    events,
  };
  return ctx;
}
