/** D5206 mutation check — the deferred race kills a missing latest-id guard. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const deferred = () => {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
};

test('a stale-success mutation is killed', async () => {
  const path = new URL('../src/pages/calendarReadController.js', import.meta.url);
  const original = readFileSync(path, 'utf8');
  const mutant = original
    .replace("import { useCallback, useEffect, useRef, useState } from 'react';", 'const useCallback = null, useEffect = null, useRef = null, useState = null;')
    .replace('if (this.active !== requestId) return false;', 'if (false) return false;');
  assert.notEqual(mutant, original);
  const module = await import(`data:text/javascript;base64,${Buffer.from(mutant).toString('base64')}`);
  const c = new module.CalendarReadController();
  const a = deferred(); const b = deferred();
  const pa = c.read({ key: 'month', window: {}, request: () => a.promise });
  const pb = c.read({ key: 'week', window: {}, request: () => b.promise });
  b.resolve({ items: [{ id: 'week' }] }); await pb;
  a.resolve({ items: [{ id: 'month' }] }); await pa;
  assert.notEqual(c.state.items[0].id, 'week', 'the mutant unexpectedly preserved the latest response');
});
