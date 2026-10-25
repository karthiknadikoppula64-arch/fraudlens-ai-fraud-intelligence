import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV_GROUPS, NAV_ORDER, ROUTES, pathToTab } from '../routes.ts';

test('sidebar groups list every route exactly once; Reference group is secondary and last', () => {
  const all = NAV_GROUPS.flatMap((g) => g.items);
  assert.equal(all.length, new Set(all).size);
  assert.deepEqual(new Set(all), new Set(NAV_ORDER));
  const ref = NAV_GROUPS[NAV_GROUPS.length - 1];
  assert.equal(ref.secondary, true);
  assert.deepEqual(ref.items, ['methodology', 'about']);
  assert.equal(NAV_GROUPS.filter((g) => g.secondary).length, 1);
});

test('all routes still resolve', () => {
  for (const id of NAV_ORDER) assert.equal(pathToTab(ROUTES[id].path), id);
  assert.equal(pathToTab('/'), 'overview');
  assert.equal(pathToTab('/transactions'), 'stream');
  assert.equal(pathToTab('/workbench'), 'queue');
  assert.equal(pathToTab('/manual'), 'manual');
  assert.equal(pathToTab('/nope'), null);
});
