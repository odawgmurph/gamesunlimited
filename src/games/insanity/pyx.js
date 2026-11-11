/** Loads the converted Pretend You're Xyzzy card database once per page. */
let promise = null;

export function loadPyx() {
  promise ??= fetch('/games/insanity/pyx-cards.json')
    .then((r) => {
      if (!r.ok) throw new Error(`card list HTTP ${r.status}`);
      return r.json();
    })
    .catch((err) => {
      promise = null;
      throw err;
    });
  return promise;
}
