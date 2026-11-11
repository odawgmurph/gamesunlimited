/**
 * Game registry. Games are listed in src/games/index.js as small manifests;
 * the heavy parts (rules, UI, assets) are loaded lazily the first time a game
 * is selected.
 */
import { GAMES } from '../games/index.js';

const byId = new Map(GAMES.map((g) => [g.id, g]));
const loaded = new Map(); // id -> { manifest, logic, View, assets }
const loading = new Map(); // id -> Promise

export function listGames() {
  return GAMES;
}

export function getManifest(id) {
  return byId.get(id) || null;
}

/** Loads a game's module and assets. Safe to call repeatedly. */
export function loadGame(id) {
  const manifest = byId.get(id);
  if (!manifest) return Promise.reject(new Error(`Unknown game "${id}"`));
  if (!loading.has(id)) {
    const p = (async () => {
      const mod = await manifest.load();
      const assets = mod.prepare ? await mod.prepare() : {};
      const game = { manifest, logic: mod.logic, View: mod.View, assets };
      loaded.set(id, game);
      return game;
    })();
    p.catch(() => loading.delete(id));
    loading.set(id, p);
  }
  return loading.get(id);
}

/** Synchronous accessor: the loaded game or null if it's not loaded yet. */
export function getLoadedGame(id) {
  return loaded.get(id) || null;
}

export function defaultSettings(manifest) {
  const out = {};
  for (const s of manifest.settings || []) out[s.key] = s.default;
  return out;
}

/** Validates/clamps settings against the manifest schema. Unknown keys are dropped. */
export function sanitizeSettings(manifest, input = {}) {
  const out = defaultSettings(manifest);
  for (const s of manifest.settings || []) {
    if (!(s.key in input)) continue;
    const v = input[s.key];
    if (s.type === 'number') {
      const n = Number(v);
      if (Number.isFinite(n)) out[s.key] = Math.min(s.max ?? Infinity, Math.max(s.min ?? -Infinity, Math.round(n / (s.step || 1)) * (s.step || 1)));
    } else if (s.type === 'toggle') {
      out[s.key] = !!v;
    } else if (s.type === 'select') {
      if (s.options.some((o) => o.value === v)) out[s.key] = v;
    }
  }
  return out;
}
