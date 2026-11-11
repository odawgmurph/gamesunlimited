import { test } from 'node:test';
import assert from 'node:assert/strict';
import { succession, heirOf, sanitizeName } from '../src/core/succession.js';

const room = {
  hostId: 'h',
  members: [
    { id: 'old', seq: 1, promoted: null },
    { id: 'h', seq: 3, promoted: null },
    { id: 'co2', seq: 5, promoted: 2 },
    { id: 'co1', seq: 6, promoted: 1 },
    { id: 'new', seq: 7, promoted: null },
    { id: 'gone', seq: 0, promoted: null, connected: false },
  ],
};

test('host first, then co-hosts by promotion order, then seniority; offline skipped', () => {
  assert.deepEqual(succession(room).map((m) => m.id), ['h', 'co1', 'co2', 'old', 'new']);
  assert.equal(heirOf(room).id, 'co1');
});

test('without co-hosts the most senior member inherits', () => {
  const r = { hostId: 'h', members: room.members.map((m) => ({ ...m, promoted: null })) };
  assert.equal(heirOf(r).id, 'old');
});

test('names are cleaned', () => {
  assert.equal(sanitizeName('  <b>Bob</b>   the   builder  '), 'bBob/b the builder');
  assert.equal(sanitizeName(''), 'Player');
  assert.equal(sanitizeName('x'.repeat(50)).length, 20);
});
