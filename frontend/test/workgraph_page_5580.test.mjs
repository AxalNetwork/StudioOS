// D5580 part 5 (#5580): the HQ WorkGraph page, built to the canvas's boards
// WG-01 to WG-07 at the owner's route A with layout A (three tabs).
//
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/workgraph_page_5580.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';

import {
  TABS, tabOf, pageState, workOf, summary, countWords, pairGroups, hunkWords, mergeWords, checksWords, queueWords, baseWords,
  claimOfPr, repoUrl, scanTime, ageWords,
} from '../src/pages/hq/workgraph/workgraphModel.js';
import { WorkGraphView } from '../src/pages/hq/workgraph/WorkGraphPage.jsx';
import { CONSOLE_GROUPS } from '../src/pages/hq/platformOverviewModel.js';

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8');

// A snapshot in the v2 shape scripts/lib/prRisk.mjs writes (sample values).
const intent = (issue, action, extra = {}) => ({
  issue, holder: { slot: 'S01', agent: 'agent-x', session: 'abcdef1234' },
  registration: { source: 'ref', registeredAt: '2026-11-15T08:00:00.000Z', renewedAt: null, ttlHours: 24, expiresAt: '2026-11-16T08:00:00.000Z', expired: false },
  base: { sha: 'a'.repeat(40), ageHours: 5, onMain: true, stale: false }, prs: [100 + issue], paths: ['a/x.js', 'a/y.js'], pathsSource: 'pr', dependsOn: [],
  lease: { status: 'not read', reason: 'the #5618 lease is read only with the Merge Control owner token' },
  workItem: { risk: 'Low' }, notes: [], recommendation: { action, reasons: action === 'proceed' ? [] : [{ action, with: '#2', rule: 'same module', path: 'a/' }] },
  ...extra,
});
const SNAP = {
  schema: 'studioos-pr-overlap-snapshot/v2', generatedAt: '2026-11-16T14:31:00.000Z', repo: 'example/repo', partial: false, notes: ['2 duplicate PR row(s) removed'],
  workInFlight: {
    status: 'read', partial: false, refused: ['#9: claim ref refused: slot "S52" is not a slot'], notes: ['#7: read as history'],
    intents: [intent(1, 'serialize'), intent(2, 'serialize'), intent(3, 'wait', { registration: { source: 'ref', expired: true, expiresAt: '2026-11-15T08:00:00.000Z', ttlHours: 12 } }), intent(4, 'proceed', { holder: { slot: 'S26', agent: null, session: null }, registration: { source: 'label' }, base: { sha: null, reason: 'a label claim has none' }, prs: [], paths: [] })],
  },
  prs: [
    { number: 101, draft: false, stale: false, paths: ['a/x.js'], evidence: { merge: { status: 'conflict' }, checks: { status: 'failed', failed: ['worker-tests'], pending: [], missing: [] }, queue: { status: 'measured', jobs: 9, maxMinutes: 14, p50Minutes: 5, stillQueued: 0 }, baseAge: { status: 'measured', behindBy: 2, ageHours: 5 } } },
    { number: 102, draft: true, stale: false, paths: ['a/x.js'], evidence: { merge: { status: 'unknown', reason: 'GitHub has not computed mergeability' }, checks: { status: 'unknown', reason: 'check runs unreadable' }, queue: { status: 'not measured', reason: 'no CI run on this head' }, baseAge: { status: 'unknown', reason: 'compare unreadable' } } },
  ],
  pairs: [
    { a: 101, b: 102, risk: 'overlapping-hunks', textualConflict: 'yes', migrationStamps: ['202611141030'], paths: [{ path: 'cloudflare-worker/sql/schema.sql', pathClass: 'schema', risk: 'critical', why: null, hunks: { class: 'overlapping-hunks', ranges: [{ a: { start: 112, end: 140 }, b: { start: 118, end: 131 } }] } }] },
    { a: 101, b: 103, risk: 'same-path-disjoint-hunks', textualConflict: 'no', migrationStamps: [], paths: [{ path: 'frontend/src/A.jsx', pathClass: 'path', risk: 'same-path-disjoint-hunks', hunks: { class: 'same-path-disjoint-hunks', a: [{ start: 1, end: 4 }], b: [{ start: 40, end: 40 }] } }] },
    { a: 102, b: 103, risk: 'unknown-hunks', textualConflict: 'not checked', migrationStamps: [], paths: [{ path: 'cloudflare-worker/src/x.ts', pathClass: 'path', risk: 'unknown-hunks', hunks: { class: 'unknown-hunks', reason: 'base file unreadable' } }] },
  ],
};
const READ = { status: 'read', generated_at: SNAP.generatedAt, received_at: '2026-11-16T14:32:00Z', partial: false, schema: SNAP.schema, age_minutes: 14, stale: false, stale_after_minutes: 150, snapshot: SNAP };

const render = (tab, state) => renderToStaticMarkup(React.createElement(MemoryRouter, null, React.createElement(WorkGraphView, { tab, state, onRetry: () => {} })));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

test('the owner\'s route A and layout A: three tabs at their own addresses, linked from Infrastructure', () => {
  assert.deepEqual(TABS.map((t) => t.to), ['/admin/workgraph/in-flight', '/admin/workgraph/pairs', '/admin/workgraph/evidence']);
  assert.equal(tabOf('/admin/workgraph/pairs'), 'pairs');
  assert.equal(tabOf('/admin/workgraph/evidence'), 'evidence');
  assert.equal(tabOf('/admin/workgraph/in-flight'), 'in-flight');
  const routes = src('routes/adminWorkgraph.jsx');
  for (const t of TABS) assert.match(routes, new RegExp(`path="${t.to}" element=\\{guard\\(\\['admin'\\], hqOnly\\(<WorkGraphPage />\\)\\)\\}`));
  const infra = CONSOLE_GROUPS.find(([g]) => g === 'Infrastructure')[1];
  assert.ok(infra.some(([label, to]) => label === 'WorkGraph' && to === '/admin/workgraph/in-flight'), 'linked from Detailed consoles › Infrastructure');
  assert.match(src('lib/api/adminWorkgraph.js'), /request\('\/admin\/workgraph\/in-flight'\)/, 'the one read');
});

test('the read becomes a state: refused on 403, unreadable otherwise, none, a stored scan unreadable, read', () => {
  assert.equal(pageState(null, { status: 403 }).kind, 'refused');
  assert.equal(pageState(null, { status: 500 }).kind, 'unreadable');
  assert.equal(pageState(null, null).kind, 'loading');
  assert.equal(pageState({ status: 'none', reason: 'x' }).kind, 'none');
  assert.equal(pageState({ status: 'unreadable', reason: 'y' }).kind, 'snapshot-unreadable');
  assert.equal(pageState({ status: 'read' }).kind, 'unreadable', 'a read with no snapshot is not drawn as empty');
  const s = pageState(READ);
  assert.deepEqual([s.kind, s.stale, s.partial, s.ageMinutes], ['read', false, false, 14]);
  assert.equal(pageState({ ...READ, partial: false, snapshot: { ...SNAP, partial: true } }).partial, true, 'the snapshot\'s own partial flag counts');
});

test('the summary counts each action, the expired claims still held and the refused registrations', () => {
  const s = summary(workOf(SNAP));
  assert.deepEqual(s, { held: 4, actions: { serialize: 2, wait: 1, coordinate: 0, proceed: 1 }, expired: 1, refused: 1 });
  assert.equal(countWords(4, true), '≥ 4');
  assert.equal(countWords(4, false), '4');
  assert.equal(workOf({}).status, 'not read', 'no section is not "no work"');
  assert.equal(workOf({ workInFlight: { status: 'unreadable', reason: 'cap' } }).status, 'unreadable');
});

test('pairs group by top folder in the scan\'s order; hunks and evidence keep their own words', () => {
  assert.deepEqual(pairGroups(SNAP.pairs).map((g) => [g.module, g.rows.map((r) => r.index)]), [['cloudflare-worker', [0, 2]], ['frontend', [1]]]);
  assert.deepEqual(hunkWords(SNAP.pairs[0].paths[0].hunks), { kind: 'overlap', text: 'L112–140 meets L118–131' });
  assert.equal(hunkWords(SNAP.pairs[1].paths[0].hunks).b, 'L40');
  assert.equal(hunkWords(SNAP.pairs[2].paths[0].hunks).text, 'Hunks unknown: base file unreadable');
  assert.deepEqual(mergeWords({ status: 'conflict' }), { tone: 'bad', text: 'Conflict' });
  assert.equal(mergeWords({}).text, 'Unknown');
  assert.equal(checksWords({ status: 'pending', pending: ['lint'], missing: ['drift'] }).why, 'lint, drift (not reported yet)');
  assert.equal(queueWords({ status: 'not measured', reason: 'no CI run on this head' }).text, 'Not measured');
  assert.equal(queueWords(SNAP.prs[0].evidence.queue).text, 'max 14 min · median 5 min');
  assert.equal(baseWords(SNAP.prs[0].evidence.baseAge).text, '2 behind');
  assert.equal(claimOfPr(workOf(SNAP), 101), 1);
  assert.equal(claimOfPr(workOf(SNAP), 999), null);
  assert.equal(repoUrl('example/repo'), 'https://github.com/example/repo');
  assert.equal(repoUrl('not a repo/x y'), null, 'no link built from a malformed repo');
  assert.equal(scanTime('2026-11-16T14:31:00.000Z'), '14:31 UTC');
  assert.equal(ageWords(194), '3 h 14 min ago');
});

test('WG-01 Work in flight: the summary, the rows, Refused and Notes, every count naming its scan', () => {
  const t = text(render('in-flight', pageState(READ)));
  assert.match(t, /Work in flight/);
  assert.match(t, /Counts are from the 14:31 UTC scan/);
  assert.match(t, /2 to serialize in the 14:31 UTC scan/);
  assert.match(t, /1 past expiry in the 14:31 UTC scan/);
  assert.match(t, /Expired, still held/);
  assert.match(t, /claim ref refused: slot "S52"/);
  assert.match(t, /read as history/);
  assert.match(t, /fresh · scanned 14 min ago/);
  assert.match(t, /a label claim records no times/, 'a label claim\'s times are Not recorded with the reason');
  assert.match(t, /a label claim has none/);
  assert.doesNotMatch(t, /≥/, 'a full scan does not say "at least"');
  const html = render('in-flight', pageState(READ));
  assert.match(html, /href="https:\/\/github.com\/example\/repo\/issues\/1" target="_blank" rel="noopener noreferrer"/, 'GitHub links open in a new tab');
  assert.match(html, /aria-current="page"[^>]*>Work in flight/);
});

test('WG-02 PR pairs: the risk-class legend, groups with Not recorded owners, conflict words and stamps', () => {
  const t = text(render('pairs', pageState(READ)));
  assert.match(t, /A class is a risk signal, not a merge verdict\./);
  assert.match(t, /cloudflare-worker\/ · 2 pairs/);
  assert.match(t, /integration owners not assigned yet/);
  assert.match(t, /Conflict: Yes/);
  assert.match(t, /Conflict: No/);
  assert.match(t, /Not checked/);
  assert.match(t, /⌗ 202611141030 in both/);
  assert.match(t, /3 overlapping pairs among 2 open PRs in the 14:31 UTC scan/);
});

test('WG-03 PR evidence: four separate readings with their reasons, review delay Not recorded', () => {
  const t = text(render('evidence', pageState(READ)));
  for (const h of ['Merge status', 'Required checks', 'CI queue delay', 'Base']) assert.match(t, new RegExp(h));
  assert.match(t, /Conflict/);
  assert.match(t, /Failed worker-tests/);
  assert.match(t, /GitHub has not computed mergeability/);
  assert.match(t, /no CI run on this head/);
  assert.match(t, /compare unreadable/);
  assert.match(t, /review delay is not measured yet/);
  assert.match(t, /claim #1/);
});

test('WG-04 and WG-05: empty, loading, none, unreadable, work not read, stale, partial and refused are each said', () => {
  const empty = { ...SNAP, workInFlight: { status: 'read', intents: [], refused: [], notes: [] }, pairs: [] };
  assert.match(text(render('in-flight', pageState({ ...READ, snapshot: empty }))), /No claimed work found in the 14:31 UTC scan\. .*measured zero/);
  assert.match(text(render('pairs', pageState({ ...READ, snapshot: empty }))), /No overlapping PRs in this scan\./);
  assert.match(render('in-flight', pageState(null, null)), /aria-busy="true"/);
  assert.match(text(render('in-flight', pageState({ status: 'none', reason: 'No scan has been posted yet' }))), /not “no work”/);
  const un = text(render('in-flight', pageState({ status: 'unreadable', reason: 'The stored scan could not be read.' })));
  assert.match(un, /could not be read/);
  assert.match(un, /not “no work” and not “no conflicts”/);
  const gone = text(render('in-flight', pageState({ ...READ, snapshot: { ...SNAP, workInFlight: { status: 'unreadable', reason: 'request cap reached before the claim refs were read' } } })));
  assert.match(gone, /request cap reached before the claim refs were read/);
  assert.match(gone, /not “no work”/);
  assert.doesNotMatch(gone, /Claims held/, 'an unreadable claims read draws no counts');
  const stale = text(render('in-flight', pageState({ ...READ, stale: true, age_minutes: 194 })));
  assert.match(stale, /This scan is Stale: taken 16 Nov 14:31 UTC, 3 h 14 min ago\./);
  const partial = text(render('in-flight', pageState({ ...READ, partial: true })));
  assert.match(partial, /Partial scan in the 14:31 UTC scan\./);
  assert.match(partial, /2 duplicate PR row\(s\) removed/);
  assert.match(partial, /≥ 2/, 'a partial scan\'s counts are lower bounds');
  const refused = text(render('in-flight', pageState(null, { status: 403 })));
  assert.match(refused, /Only Super Admins see work in flight/);
  assert.doesNotMatch(refused, /14:31/, 'nothing about the scan is shown');
  assert.match(refused, /Scan not read freshness unknown/, 'the header says no scan was read');
});

test('WG-06 phone and WG-07 dark: cards below md, 44px targets, and every light class has its dark pair', () => {
  const page = src('pages/hq/workgraph/WorkGraphPage.jsx');
  assert.match(page, /md:hidden" data-testid="wg-wif-cards"/);
  assert.match(page, /md:hidden" data-testid="wg-ev-cards"/);
  assert.match(page, /hidden w-full border-collapse md:table/);
  assert.match(page, /min-h-\[44px\]/);
  for (const m of page.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const cls = m[1] || m[2] || '';
    if (/\bbg-white\b/.test(cls)) assert.match(cls, /dark:bg-/, cls);
    if (/\bborder-axal-hairline\b/.test(cls)) assert.match(cls, /dark:border-/, cls);
  }
  assert.doesNotMatch(page.replace(/recommendation/g, ''), /\badvisor\b|\bfiduciary\b/i, 'Voice: no advisor or fiduciary wording');
  assert.doesNotMatch(page, /<form|onSubmit=|fetch\(/, 'the page writes nothing');
});
