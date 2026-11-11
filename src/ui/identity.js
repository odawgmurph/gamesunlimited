import { randomId } from '../net/emitter.js';

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Per-tab identity: survives reloads (so you rejoin as yourself) but each tab is its own player. */
export function getClientId() {
  let id = safe(() => sessionStorage.getItem('gu.clientId'), null);
  if (!id) {
    id = 'c' + randomId(10);
    safe(() => sessionStorage.setItem('gu.clientId', id));
  }
  return id;
}

/** The tab's own name wins (so two tabs can be two people); localStorage is the default for new tabs. */
export function getSavedName() {
  return safe(() => sessionStorage.getItem('gu.name') || localStorage.getItem('gu.name'), '') || '';
}

export function saveName(name) {
  safe(() => {
    sessionStorage.setItem('gu.name', name);
    localStorage.setItem('gu.name', name);
  });
}

/** Remember which room this tab is in, so a reload rejoins it automatically. */
export function getTabRoom() {
  return safe(() => sessionStorage.getItem('gu.room'), null);
}
export function setTabRoom(code) {
  safe(() => (code ? sessionStorage.setItem('gu.room', code) : sessionStorage.removeItem('gu.room')));
}
