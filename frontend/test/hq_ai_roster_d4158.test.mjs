// D4158 (#4158, H1 of #4137) — HQ › AI agents › Roster on the page: the
// client's four calls, SA1's rows ("Not recorded" never a 0), the filters,
// and SA2b's rules (a reason on every write, the trademark check on a rename,
// values never sent).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/hq_ai_roster_d4158.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  NOT_RECORDED, REASON_MIN, defaultsArmed, filterRoster, historyLine, identityChanges, retireLines,
  rosterCounts, rosterRefusal, rosterRow, saveArmed, statusArmed, teamLine,
} from '../src/pages/hq/aiAgents/aiAgentsModel.js';

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');
const PAGE = read('pages/hq/aiAgents/HqAiAgentsPage.jsx');
const CLIENT = read('lib/api/adminAiAgents.js');

const VESTA = {
  key: 'vesta', name: 'Vesta', tagline: 'No gate opens without its seal.', story: 'Vesta kept the Charter Vault.', goal: 'Every obligation met.',
  avatar: '/agents/vesta.webp', risk: 2, top_values: ['integrity', 'stewardship', 'collaboration'], natural_fit: ['finance', 'legal'],
  status: 'offered', defaults: { model: null, start_cap_usd: null, max_cap_usd: null },
  usage: { teams: 2, runs: 1240, spend_usd: 3.5, accepted_pct: 66.7, failed_pct: 0 },
};
const KADE = { ...VESTA, key: 'kade', name: 'Kade', tagline: 'Raise the banner.', top_values: ['curiosity', 'collaboration', 'ambition'], natural_fit: ['gtm', 'capital'], status: 'hidden',
  usage: { teams: 0, runs: 0, spend_usd: null, accepted_pct: null, failed_pct: null } };

test('1: the client calls the four roster routes, each write with its method', () => {
  // Mutation checked: rosterDefaults sent as PATCH → the PUT assert fails.
  assert.match(CLIENT, /roster: \(\) => request\('\/admin\/ai-agents\/roster'\),/);
  assert.match(CLIENT, /rosterAgent: \(key\) => request\(`\/admin\/ai-agents\/roster\/\$\{enc\(key\)\}`\),/);
  assert.match(CLIENT, /rosterUpdate: \(key, b\) => request\(`\/admin\/ai-agents\/roster\/\$\{enc\(key\)\}`, \{ method: 'PATCH', body: JSON\.stringify\(b\) \}\),/);
  assert.match(CLIENT, /rosterDefaults: \(key, b\) => request\(`\/admin\/ai-agents\/roster\/\$\{enc\(key\)\}\/defaults`, \{ method: 'PUT', body: JSON\.stringify\(b\) \}\),/);
});

test('2: SA1 rows — a figure the Worker sent as null reads "Not recorded", a measured 0 reads 0', () => {
  // Mutation checked: rosterRow using `?? 0` for spend → Kade's spend reads "$0.00" and this fails.
  const v = rosterRow(VESTA);
  assert.deepEqual([v.teams, v.runs, v.spend, v.accepted, v.failed], ['2', '1,240', '$3.50', '66.7%', '0%']);
  assert.deepEqual(v.topValues, ['Integrity', 'Stewardship', 'Collaboration']);
  assert.equal(v.risk, 'Careful');
  assert.deepEqual(v.fit, ['Finance', 'Legal']);
  const k = rosterRow(KADE);
  assert.deepEqual([k.teams, k.runs, k.spend, k.accepted, k.failed], ['0', '0', NOT_RECORDED, NOT_RECORDED, NOT_RECORDED]);
  assert.equal(k.status.label, 'Hidden');
  assert.equal(rosterCounts({ total: 16, offered: 15, hidden: 1, retired: 0 }), '16 agents · 15 offered · 1 hidden · 0 retired');
  assert.equal(rosterCounts(null), NOT_RECORDED);
});

test('3: the filters — search, status, natural fit and a top value', () => {
  const all = [VESTA, KADE];
  assert.deepEqual(filterRoster(all, { q: 'seal' }).map((p) => p.key), ['vesta']);
  assert.deepEqual(filterRoster(all, { status: 'hidden' }).map((p) => p.key), ['kade']);
  assert.deepEqual(filterRoster(all, { fit: 'legal' }).map((p) => p.key), ['vesta']);
  assert.deepEqual(filterRoster(all, { value: 'ambition' }).map((p) => p.key), ['kade']);
  assert.deepEqual(filterRoster(all, {}).map((p) => p.key), ['vesta', 'kade']);
});

test('4: SA2b — every write needs a reason, and a rename the trademark check', () => {
  // Mutations checked: saveArmed ignoring the trademark → the unchecked rename arms and this fails;
  // REASON_MIN read as 1 → a 9-character reason arms Hide and this fails.
  assert.equal(REASON_MIN, 10);
  const reason = 'x'.repeat(10);
  const short = 'x'.repeat(9);
  const rename = identityChanges(VESTA, { ...VESTA, name: ' Vestra ' });
  assert.deepEqual(rename, { name: 'Vestra' });
  assert.equal(saveArmed({ changes: rename, reason, trademark: false }), false);
  assert.equal(saveArmed({ changes: rename, reason, trademark: true }), true);
  assert.equal(saveArmed({ changes: rename, reason: short, trademark: true }), false);
  const tagline = identityChanges(VESTA, { ...VESTA, tagline: 'Seal first.' });
  assert.equal(saveArmed({ changes: tagline, reason, trademark: false }), true, 'a tagline needs no trademark check');
  assert.equal(saveArmed({ changes: {}, reason, trademark: true }), false, 'nothing to save');
  assert.equal(statusArmed({ reason: short }), false);
  assert.equal(statusArmed({ reason }), true);
  assert.equal(defaultsArmed({ model: 'm', start: 200, max: 100, reason }), false, 'the start above the maximum');
  assert.equal(defaultsArmed({ model: '', start: 20, max: 100, reason }), false);
  assert.equal(defaultsArmed({ model: 'm', start: 20, max: 100, reason }), true);
});

test('5: values are shown and never sent; the dialogs say what retiring does', () => {
  // Mutation checked: the save body spreading the whole persona → "values" reaches rosterUpdate and this fails.
  const sends = [...PAGE.matchAll(/adminAiAgentsApi\.roster(Update|Defaults)\(([^\n]*)/g)].map((m) => m[2]);
  assert.equal(sends.length, 3, 'save, status and defaults');
  for (const s of sends) assert.doesNotMatch(s, /\b(values|top_values|risk|natural_fit)\b|\.\.\.p\b/, s);
  assert.match(PAGE, /Values, risk and natural fit cannot be edited\./);
  assert.deepEqual(retireLines(VESTA), ['2 teams use Vesta. Open proposals stay decidable, and Vesta stops running at once.', 'Vesta leaves the gallery. The history and audit stay.']);
  assert.match(retireLines({ ...VESTA, usage: { teams: null } })[0], /^The teams that use this agent\./, 'an unread count is never "0 teams"');
});

test('6: the words — refusals, teams by name, and history before → after', () => {
  assert.equal(rosterRefusal({ code: 'trademark_unchecked' }), 'Tick "Trademark check done" before changing the name.');
  assert.equal(rosterRefusal({ code: 'values_fixed' }), 'Values, risk and natural fit cannot be changed.');
  // #4739: the Worker's own sentence comes from the body on `e.data`; the error's raw text is never shown.
  assert.equal(rosterRefusal({ status: 422, data: { error: 'something_new', message: 'The Worker said so.' } }), 'The Worker said so.');
  assert.equal(rosterRefusal({ message: 'socket hang up' }), 'That change was not saved.');
  assert.equal(teamLine({ company: 'Northwind Labs', project: 'Atlas Pilot' }), 'Northwind Labs › Atlas Pilot');
  assert.equal(teamLine({ company: null, project: null }), NOT_RECORDED);
  assert.equal(historyLine({ before: { status: 'offered' }, after: { status: 'hidden' } }), 'status: offered → status: hidden');
  assert.equal(historyLine({ before: { max_cap_usd: 80 }, after: { max_cap_usd: 100 } }), 'max cap: $80.00 → max cap: $100.00');
  assert.doesNotMatch(PAGE, /\.email\b/);
});
