// A nav group with no items must not render its header.
//
// This was a live defect. `SidebarNav.jsx` guarded with `if (q && visibleItems
// .length === 0) return null` — the group vanished while searching and came
// back the moment the box was cleared. Meanwhile commit 7c93b83e ("Move
// articles to user menu") took the last destination out of the admin role's
// `account` group and left `items: []` behind, so every admin had an "ACCOUNT"
// header in their sidebar that expanded to nothing at all.
//
// Two assertions, because either alone would let it back: the guard must be
// unconditional, and no role may declare a group with zero items.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { codeOnly } from './_codeOnly.mjs';
import { parseSidebar } from '../../scripts/build-profile-routing.mjs';

const read = (p) => readFileSync(resolve(p), 'utf8');

test('SidebarNav skips an empty group whether or not a search is active', () => {
  // codeOnly() because the fix's own comment quotes the old `q &&` guard, and
  // a raw-text search would match the explanation instead of the code.
  const src = codeOnly(read('frontend/src/ui/SidebarNav.jsx'));
  assert.match(src, /if \(visibleItems\.length === 0\) return null;/);
  assert.doesNotMatch(src, /if \(q && visibleItems\.length === 0\)/);
});

test('no role declares a group with zero destinations', () => {
  const raw = read('frontend/src/sidebarConfig.js');
  const roles = parseSidebar(raw);
  // Role-scoped on purpose. Checking labels globally would have passed this
  // very defect: the admin role's empty `Account` group shares its label with
  // the `exploring` role's populated one, so a label-only set says "covered".
  const declared = [];
  let role = null;
  for (const line of raw.split('\n')) {
    const r = line.match(/^\s{2}([a-z]+):\s*\[/);
    if (r) { role = r[1]; continue; }
    const g = line.match(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*items:\s*\[/);
    if (g && role) declared.push({ role, label: g[2] });
  }
  assert.ok(declared.length > 0, 'no groups parsed — the parser broke, not the config');
  const populated = new Set(
    Object.entries(roles).flatMap(([r, items]) => items.map((i) => `${r}::${i.group}`)),
  );
  const empty = declared
    .filter((d) => !populated.has(`${d.role}::${d.label}`))
    .map((d) => `${d.role} · ${d.label}`);
  assert.deepEqual(
    empty, [],
    `these groups render a header over nothing: ${empty.join(', ')}`,
  );
});
