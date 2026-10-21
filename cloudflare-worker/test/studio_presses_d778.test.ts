/**
 * D778 part 12 (#2103) — the Studio interview's Send (`POST /tool/auto`) and
 * Explain (`POST /explain`) name each profile's own option on their runs. The
 * press's headers win (`railFor`); with no rail context the route falls back to
 * the caller's profile's key, on the shared `studio` page.
 *
 *   node --experimental-strip-types --no-warnings --import ./cloudflare-worker/test/_ts-loader.mjs \
 *     --test cloudflare-worker/test/studio_presses_d778.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STUDIO_OPTIONS, studioOption } from '../src/services/advisor/studioRail.ts';
import { FOUNDER_OPTIONS } from '../../frontend/src/lib/railOptions/founder.js';
import { ADVISOR_RAIL_OPTIONS } from '../../frontend/src/lib/railOptions/advisor.js';
import { PARTNER_RAIL_OPTIONS } from '../../frontend/src/lib/railOptions/partner.js';
import { controlOf } from '../../frontend/src/lib/railOptions/index.js';

const STUDIO = /components\/advisor\/PersonalAdvisor\.jsx$/;
const advisor = readFileSync(new URL('../src/routes/advisor.ts', import.meta.url), 'utf8');
/** One handler's body, from its registration to the next one. */
const route = (path: string) => {
  const at = advisor.indexOf(`advisor.post('${path}'`);
  assert.ok(at >= 0, `${path} is gone`);
  const next = advisor.slice(at + 1).search(/\nadvisor\.(get|post|put|patch|delete)\(/);
  return advisor.slice(at, next < 0 ? undefined : at + 1 + next);
};

/** Every Studio Send and Explain row of the three inventories, by the control `railOptionFor` reads. */
function inventoryRows() {
  const rows: Array<{ role: string; control: string; key: string }> = [];
  for (const o of FOUNDER_OPTIONS as any[]) {
    for (const [file, marker] of o.at || []) {
      const control = controlOf(marker);
      if (STUDIO.test(file) && (control === 'send' || control === 'explain')) rows.push({ role: 'founder', control, key: o.key });
    }
  }
  for (const [role, list] of [['advisor', ADVISOR_RAIL_OPTIONS], ['partner', PARTNER_RAIL_OPTIONS]] as const) {
    for (const o of list as any[]) {
      const control = controlOf(o.source?.marker);
      if (STUDIO.test(o.source?.file || '') && (control === 'send' || control === 'explain')) rows.push({ role, control, key: o.key });
    }
  }
  return rows;
}

test('D778: each profile\'s Studio fallback is the key its own inventory gives the press', () => {
  // Mutations checked: the advisor given the founder's `ask:studio`; a profile dropped from the map.
  const rows = inventoryRows();
  assert.deepEqual([...new Set(rows.map((r) => `${r.role}|${r.control}`))].sort(),
    ['advisor|explain', 'advisor|send', 'founder|explain', 'founder|send', 'partner|explain', 'partner|send']);
  for (const r of rows) assert.equal(studioOption(r.control as 'send' | 'explain', r.role), r.key, `${r.role} · ${r.control}`);
  for (const [press, byRole] of Object.entries(STUDIO_OPTIONS)) {
    for (const role of Object.keys(byRole)) assert.ok(rows.some((r) => r.role === role && r.control === press), `${role} has no ${press} row`);
  }
  // A role whose inventory has no such press keeps the old keys.
  assert.equal(studioOption('send', 'investor'), 'tool:advisor');
  assert.equal(studioOption('explain', 'admin'), 'explain:advisor');
  assert.equal(studioOption('send', undefined), 'tool:advisor');
});

test('D778: Send and Explain name the caller\'s option through railFor, on the shared studio page', () => {
  // Mutations checked: either route back on its fixed key; the route passing a fixed context instead of railFor.
  const send = route('/tool/auto');
  const explain = route('/explain');
  assert.match(send, /rail: railFor\(c, \{ page: pageFromPath\(AI_SURFACE\.studio, 'studio'\), option: studioOption\('send', user\.role\) \}\)/);
  assert.match(explain, /rail: railFor\(c, \{ page: pageFromPath\(AI_SURFACE\.studio, 'studio'\), option: studioOption\('explain', user\.role\) \}\)/);
  assert.doesNotMatch(advisor, /option: '(tool|explain):advisor'/);
  // The answer route runs no option's model: its one run is the input guard on the member's
  // own words, which carries no rail, so the page's AI switch can never refuse a save.
  const answer = route('/answer');
  assert.doesNotMatch(answer, /railFor\(/);
  assert.match(answer, /classifyInput\(c\.env, user\.id, valueStr, AI_SURFACE\.studio\)/);
});
