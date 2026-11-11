/**
 * Host succession order. The current host is first, then promoted members
 * (co-hosts) in the order they were promoted, then everyone else by seniority
 * (join order). Disconnected members are skipped.
 *
 * Works on both the authoritative room state and the public room view.
 */
export function succession(room) {
  const live = room.members.filter((m) => m.connected !== false);
  const host = live.find((m) => m.id === room.hostId);
  const promoted = live
    .filter((m) => m.id !== room.hostId && m.promoted != null)
    .sort((a, b) => a.promoted - b.promoted);
  const rest = live
    .filter((m) => m.id !== room.hostId && m.promoted == null)
    .sort((a, b) => a.seq - b.seq);
  return [...(host ? [host] : []), ...promoted, ...rest];
}

/** The member who would become host if the current host vanished right now. */
export function heirOf(room) {
  return succession(room).find((m) => m.id !== room.hostId) || null;
}

export function sanitizeName(name) {
  const clean = String(name ?? '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 20);
  return clean || 'Player';
}
