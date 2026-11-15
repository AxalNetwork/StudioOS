/**
 * #5507 — read Build's connector parts through `buildParts.jsx`'s own exports,
 * for the provider suites. Each provider suite asks about ITS key only: the
 * modules it sits on, where it sits relative to the neighbours its canvas
 * names, and what its render function mounts. The full catalogue (every
 * module's complete, ordered list) is owned by one file,
 * `build_parts_contract_5507.test.mjs`, and nowhere else.
 */
import assert from 'node:assert/strict';
import { BUILD_PARTS } from '../src/pages/cycles/buildParts.jsx';

/** The connector keys a module lists, in order. */
export const keysOf = (slug) => (BUILD_PARTS[slug] || []).map(([key]) => key);

/** The modules a connector sits on, sorted: membership, not order. */
export const modulesWith = (key) => Object.keys(BUILD_PARTS).filter((slug) => keysOf(slug).includes(key)).sort();

/** True when both keys sit on the module and `a` draws before `b`. */
export function isBefore(slug, a, b) {
  const keys = keysOf(slug);
  return keys.includes(a) && keys.includes(b) && keys.indexOf(a) < keys.indexOf(b);
}

/** The element one module's part renders for `data` and `ctx`; fails when the part is missing or unbuilt. */
export function partElement(slug, key, data = {}, ctx = {}) {
  const entry = (BUILD_PARTS[slug] || []).find(([k]) => k === key);
  assert.ok(entry, `${slug} lists no ${key} part`);
  assert.equal(typeof entry[1], 'function', `${slug}'s ${key} part is not built`);
  return entry[1](data, ctx);
}
