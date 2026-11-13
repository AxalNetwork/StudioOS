/**
 * D912 (#2696, part 6 of #2454) — the narrative's Claims tab (NAR6), the
 * claim drawer (NAR7, NAR7b, NAR15c, NAR19c), the Check tab (NAR8) and Phrase
 * the fix (NAR9):
 *
 *   - each claim state from the Worker's store; "Needs you first", the State,
 *     Source and Section filters; the 100% bar with a dashed Not backed
 *     segment, its legend and Table;
 *   - Not backed: the Evidence candidates and Eadwyn's proposed links on
 *     lavender, each linked behind a confirmation; none says so (NAR15c);
 *   - Mismatch: both figures and both sources, Use the record's figure and
 *     Keep mine, with a note, each behind a confirmation;
 *   - the check against the deck and the metrics, Run the check, Last checked,
 *     and "Nothing compared yet.";
 *   - the fix is for the row clicked, carries no number, and Accept places it
 *     in Story.
 *
 * Every name and figure is synthetic; the APIs are stubbed.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_claims_d912.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';

import ClaimsTab from '../src/pages/raise/narrative/ClaimsTab.jsx';
import CheckTab from '../src/pages/raise/narrative/CheckTab.jsx';
import { narrativeApi } from '../src/lib/api/narrative.js';
import { raiseEvidenceApi } from '../src/lib/api/raiseEvidence.js';
import { api } from '../src/lib/api.js';
import {
  NOTHING_COMPARED, NO_RECORDS, acceptFixHref, againstLine, appendFix, checkLine, claimLine, filterClaims, fixParts, fixScope, sectionOptions, sourceBar,
} from '../src/pages/raise/narrative/claimsModel.js';

const h = React.createElement;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const item = (uid, label, extra = {}) => ({ uid, kind: 'kpi-snapshot', source_label: label, provider: null, observed_on: '2026-10-20', summary: `Synthetic ${uid}.`, version: 1, ...extra });
const MISMATCH = {
  uid: 'c1', figure: 'paying_customers', label: 'Paying customers', section: 'traction', section_label: 'Traction', state: 'mismatch', best_source: 'connector',
  stated_value: '42', stated_shown: '42', record: { value: 38, shown: '38', source_label: 'connector', provider: 'stripe', observed_on: '2026-10-20' },
  links: [], candidates: [], eadwyn: [], note: null, note_outdated: false,
};
const NOT_BACKED = {
  uid: 'c2', figure: 'headcount', label: 'Headcount', section: 'team', section_label: 'Team', state: 'not_backed', best_source: null,
  stated_value: '7', stated_shown: '7', record: null, links: [],
  candidates: [item('item4', 'typed')], eadwyn: [{ proposal_uid: 'prop1', item: item('item5', 'document') }], note: null,
};
const BARE = { ...NOT_BACKED, uid: 'c3', figure: 'raise', label: 'The raise', section: 'ask', section_label: 'The ask', candidates: [], eadwyn: [] };
const BACKED = { ...MISMATCH, uid: 'c4', figure: 'mrr', label: 'MRR', state: 'backed', stated_shown: '$10,000', record: { value: 10000, shown: '$10,000', source_label: 'connector', provider: 'stripe', observed_on: '2026-10-20' } };
const CLAIMS = (over = {}) => ({
  version: 1, can_check: true, checked_at: '2026-10-27 14:05:00',
  claims: [BACKED, NOT_BACKED, MISMATCH, BARE], counts: { backed: 1, founders_figure: 0, mismatch: 1, not_backed: 2 },
  by_source: { connector: 2, signed: 0, document: 0, recorded: 0, typed: 0, not_backed: 2 }, ...over,
});
const CHECK = (over = {}) => ({
  version: 1, against: ['deck', 'metrics'], deck: { version: 6, state: 'ok' }, checked_at: '2026-10-27 14:05:00', can_check: true, compared: 1, mismatches: 1,
  rows: [
    { figure: 'paying_customers', label: 'Paying customers', section: 'traction', section_label: 'Traction', narrative: { value: 42, shown: '42' },
      deck: { side: 'deck', value: 40, shown: '40', source: 'Pitch deck v6 · card 1' }, metrics: { side: 'metrics', value: 38, shown: '38', source: 'Stripe (measured) · project_metrics.paying_accounts on 2026-10-20' },
      result: 'mismatch', differs: ['deck', 'metrics'] },
    { figure: 'lois', label: 'Letters of intent', section: 'traction', section_label: 'Traction', narrative: { value: 3, shown: '3' }, deck: null, metrics: null, result: 'not_compared', differs: [] },
  ], ...over,
});

function stub(over = {}) {
  const calls = [];
  const rec = (name, f) => async (...args) => { calls.push([name, ...args]); return (over[name] || f)(...args); };
  Object.assign(narrativeApi, {
    claims: rec('claims', async () => CLAIMS()),
    check: rec('check', async () => CHECK()),
    runCheck: rec('runCheck', async () => CHECK({ checked_at: '2026-10-27 15:00:00' })),
    useRecord: rec('useRecord', async () => ({ version: 1 })),
  });
  Object.assign(raiseEvidenceApi, { link: rec('link', async () => ({ linked: true })), note: rec('note', async () => ({ ok: true })) });
  api.research.zoneDraftRun = rec('zoneDraftRun', async () => ({ item: { uid: 'd1', body: 'Bring the traction line to the measured count, or correct the record.\n\nAs the check found them: Paying customers: 42 in Narrative · traction.takeaway, 38 in Stripe.' } }));
  return calls;
}

async function mount(el, url = '/raise/investor-narrative/claims?project_id=7&version=1') {
  const restore = installDocument();
  if (!document.documentElement?.classList) document.documentElement = { ...(document.documentElement || {}), classList: { contains: () => false } };
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {}; globalThis.dispatchEvent = () => true;
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const at = { path: '', search: '' };
  function Probe() { const l = useLocation(); at.path = l.pathname; at.search = l.search; return null; }
  const settle = () => act(async () => { for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0)); });
  await act(async () => { root.render(h(MemoryRouter, { initialEntries: [url] }, el, h(Probe))); });
  await settle();
  const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
  const pr = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
  const by = (id) => walk(container).find((n) => pr(n)['data-testid'] === id);
  const all = (prefix) => walk(container).map((n) => pr(n)['data-testid']).filter((id) => id && id.startsWith(prefix));
  const txt = (n) => (!n ? '' : n.nodeType === 3 ? n.textContent || '' : n.childNodes?.length ? n.childNodes.map(txt).join(' ') : n.textContent || '');
  const need = (id) => { const n = by(id); if (!n) throw new Error(`Missing ${id}`); return n; };
  return {
    at, by, all, props: (id) => pr(need(id)),
    text: (id) => txt(id ? need(id) : container).replace(/\s+/g, ' ').trim(),
    async click(id) { await act(async () => { await pr(need(id)).onClick?.({ preventDefault() {}, stopPropagation() {} }); }); await settle(); },
    async type(id, value) { await act(async () => { pr(need(id)).onChange({ target: { value, checked: value } }); }); await settle(); },
    async close() { await act(async () => root.unmount()); restore(); },
  };
}
const claims = (props = {}) => h(ClaimsTab, { projectId: 7, version: 1, search: '?project_id=7&version=1', ...props });
const check = (props = {}) => h(CheckTab, { projectId: 7, version: 1, search: '?project_id=7&version=1', ...props });
const named = (calls, n) => calls.filter((c) => c[0] === n).map((c) => c.slice(1));

// ------------------------------------------------------------------ the model

test('the model: Needs you first, the filters, the 100% bar with Not backed dashed, and nothing compared said plainly', () => {
  const all = CLAIMS().claims;
  assert.deepEqual(filterClaims(all).map((c) => c.uid), ['c1', 'c2', 'c3', 'c4']);
  assert.deepEqual(filterClaims(all).map((c) => c.state), ['mismatch', 'not_backed', 'not_backed', 'backed'], 'Mismatch, then Not backed, then Backed');
  assert.deepEqual(filterClaims(all, { needsFirst: false }).map((c) => c.uid), ['c4', 'c2', 'c1', 'c3'], 'the store\'s order otherwise');
  assert.deepEqual(filterClaims(all, { state: 'not_backed' }).map((c) => c.uid), ['c2', 'c3']);
  assert.deepEqual(filterClaims(all, { source: 'not_backed' }).map((c) => c.uid), ['c2', 'c3']);
  assert.deepEqual(filterClaims(all, { source: 'connector' }).map((c) => c.uid), ['c1', 'c4']);
  assert.deepEqual(filterClaims(all, { section: 'team' }).map((c) => c.uid), ['c2']);
  assert.deepEqual(sectionOptions(all).map((s) => s.label), ['Traction', 'Team', 'The ask']);
  const bar = sourceBar({ connector: 1, document: 1, not_backed: 1 });
  assert.deepEqual(bar.segments.map((s) => [s.key, s.pct, s.dashed]), [['connector', 34, false], ['document', 33, false], ['not_backed', 33, true]]);
  assert.equal(bar.segments.reduce((t, s) => t + s.pct, 0), 100);
  assert.equal(bar.summary, 'Claims by best source: Connector 1, Document 1, Not backed 1.');
  assert.equal(sourceBar({ connector: 0 }), null, 'no claims, no bar');
  assert.equal(claimLine(MISMATCH), 'Traction says 42. Stripe says 38 as of 2026-10-20. Neither figure is presumed right.');
  assert.equal(checkLine(CHECK()), '1 compared · 1 mismatch · 1 not compared');
  assert.equal(checkLine(CHECK({ compared: 0, mismatches: 0 })), NOTHING_COMPARED, 'never "no mismatch"');
  assert.equal(againstLine(CHECK()), 'Check against: Pitch deck v6 and the metrics.');
  assert.equal(againstLine({ against: [] }), 'Check against: nothing chosen, so nothing is compared.');
  assert.equal(fixScope(7, 1, 'paying_customers'), '7:v1:paying_customers');
  assert.deepEqual(fixParts('Words.\n\nAs the check found them: A: 1 in X, 2 in Y.'), { wording: 'Words.', found: 'A: 1 in X, 2 in Y.' });
  assert.equal(acceptFixHref('?project_id=7&version=1', 1, 'traction', 'd1'), '/raise/investor-narrative/story?project_id=7&version=1&section=traction&fix=d1');
  assert.equal(appendFix('We serve 42 paying customers.', 'Bring it to the record.'), 'We serve 42 paying customers.\n\nBring it to the record.');
  assert.equal(appendFix('', 'Only this.'), 'Only this.');
});

// ------------------------------------------------------------------ NAR6

test('NAR6: each claim with its state and best source, Needs you first, the bar dashed for Not backed, its legend and Table', async () => {
  const calls = stub();
  const v = await mount(claims());
  try {
    assert.deepEqual(named(calls, 'claims'), [[7, 1]]);
    assert.deepEqual(v.all('narrative-claim-c'), ['narrative-claim-c1', 'narrative-claim-c2', 'narrative-claim-c3', 'narrative-claim-c4'], 'Mismatch first');
    assert.match(v.text('narrative-claim-c1'), /Paying customers · 42 Traction · Connector Mismatch/);
    assert.match(v.text('narrative-claim-c2'), /Team · No record Not backed/);
    assert.ok(v.by('narrative-claims-seg-connector') && v.by('narrative-claims-seg-not_backed'));
    assert.match(String(v.props('narrative-claims-seg-not_backed').className), /border-dashed/);
    assert.match(v.text('narrative-claims-legend'), /Connector · 2 Not backed · 2/);
    await v.click('narrative-claims-table-toggle');
    assert.match(v.text('narrative-claims-bar-table'), /Connector 2 50% Not backed 2 50%/);
    await v.type('narrative-claims-state', 'backed');
    assert.deepEqual(v.all('narrative-claim-c'), ['narrative-claim-c4']);
    await v.type('narrative-claims-state', '');
    await v.type('narrative-claims-needs', false);
    assert.deepEqual(v.all('narrative-claim-c'), ['narrative-claim-c4', 'narrative-claim-c2', 'narrative-claim-c1', 'narrative-claim-c3']);
  } finally { await v.close(); }
});

test('NAR7b: a Mismatch shows both figures and both sources; Use the record\'s figure and Keep mine each confirm first', async () => {
  const calls = stub();
  const v = await mount(claims());
  try {
    await v.click('narrative-claim-c1');
    assert.match(v.text('narrative-claim-figures'), /Traction 42 Stripe 38 · 2026-10-20/);
    assert.match(v.text('narrative-claim-line'), /Neither figure is presumed right\./);
    await v.click('narrative-claim-use');
    assert.match(v.text('narrative-claim-use-confirm'), /42 becomes 38 in Traction, and the section is saved in v1\. The rest of its words stay as they are\./);
    assert.equal(named(calls, 'useRecord').length, 0, 'asked first');
    await v.click('narrative-claim-use-go');
    assert.deepEqual(named(calls, 'useRecord'), [[7, 1, 'c1', 38]]);
    assert.equal(named(calls, 'claims').length, 2, 'read again');
    await v.click('narrative-claim-c1');
    await v.click('narrative-claim-keep');
    await v.click('narrative-claim-keep-go');
    assert.equal(v.text('narrative-claim-error'), 'Say why you keep your figure.');
    await v.type('narrative-claim-keep-note', ' Trials convert after the sync. ');
    await v.click('narrative-claim-keep-go');
    assert.deepEqual(named(calls, 'note'), [[7, 'c1', 'Trials convert after the sync.']]);
  } finally { await v.close(); }
  // A kept figure shows its note and is not offered Keep again; it is still a Mismatch.
  stub({ claims: async () => CLAIMS({ claims: [{ ...MISMATCH, note: { text: 'Trials convert after the sync.', at: '2026-10-27' } }] }) });
  const kept = await mount(claims());
  try {
    await kept.click('narrative-claim-c1');
    assert.equal(kept.text('narrative-claim-note'), 'Kept, with your note: Trials convert after the sync.');
    assert.ok(!kept.by('narrative-claim-keep'));
    assert.ok(kept.by('narrative-claim-use'), 'the record\'s figure is still offered');
  } finally { await kept.close(); }
});

test('NAR7: Not backed offers the candidates and Eadwyn\'s proposed link on lavender; none says so (NAR15c)', async () => {
  const calls = stub();
  const v = await mount(claims());
  try {
    await v.click('narrative-claim-c2');
    assert.match(v.text('narrative-claim-eadwyn-prop1'), /Proposed by Eadwyn Document · 2026-10-20/);
    assert.match(v.text('narrative-claim-candidate-item4'), /Typed · 2026-10-20/);
    await v.click('narrative-claim-link-item4');
    assert.match(v.text('narrative-claim-link-confirm'), /Link Typed · 2026-10-20 to Headcount in v1\?/);
    await v.click('narrative-claim-link-go');
    assert.deepEqual(named(calls, 'link'), [[7, 'c2', 'item4', 1, undefined]]);
    await v.click('narrative-claim-c2');
    await v.click('narrative-claim-accept-prop1');
    await v.click('narrative-claim-link-go');
    assert.deepEqual(named(calls, 'link')[1], [7, 'c2', 'item5', 1, 'prop1'], 'Eadwyn\'s link is accepted as his');
    await v.click('narrative-claim-c3');
    assert.equal(v.text('narrative-claim-no-records'), NO_RECORDS);
    assert.equal(v.props('narrative-claim-evidence').to ?? v.props('narrative-claim-evidence').href, '/raise/evidence/claim/c3?project_id=7&version=1');
  } finally { await v.close(); }
});

test('an admin, or a reader who cannot check, reads and changes nothing; a failed read says so (NAR17a)', async () => {
  stub();
  const a = await mount(claims({ admin: true }));
  try {
    await a.click('narrative-claim-c1');
    assert.ok(!a.by('narrative-claim-use') && !a.by('narrative-claim-keep'));
    await a.click('narrative-claim-c2');
  } finally { await a.close(); }
  stub({ claims: async () => CLAIMS({ can_check: false }) });
  const r = await mount(claims());
  try {
    await r.click('narrative-claim-c2');
    assert.ok(!r.by('narrative-claim-link-item4'), 'no link without the check');
  } finally { await r.close(); }
  stub({ claims: async () => { throw new Error('down'); } });
  const f = await mount(claims());
  try { assert.match(f.text('narrative-claims-unreadable'), /The claims could not be read\. This is not a claim that there are none\./); } finally { await f.close(); }
});

// ------------------------------------------------------------------ NAR8 and NAR9

test('NAR8: each figure against the deck and the metrics; Run the check stamps Last checked; one place only is Not compared', async () => {
  const calls = stub();
  const v = await mount(check(), '/raise/investor-narrative/check?project_id=7&version=1');
  try {
    assert.deepEqual(named(calls, 'check'), [[7, 1]]);
    assert.equal(v.text('narrative-check-against'), 'Check against: Pitch deck v6 and the metrics.');
    assert.equal(v.text('narrative-check-summary'), '1 compared · 1 mismatch · 1 not compared');
    assert.match(v.text('narrative-check-deck-paying_customers'), /40 Pitch deck v6 · card 1/);
    assert.match(v.text('narrative-check-metrics-paying_customers'), /38 Stripe/);
    assert.equal(v.text('narrative-check-deck-lois'), 'Not stated');
    assert.equal(v.text('narrative-check-last'), 'Last checked 27 Oct 2026, 14:05 UTC');
    assert.ok(!v.by('narrative-check-fix-lois'), 'Not compared has nothing to fix');
    await v.click('narrative-check-run');
    assert.equal(named(calls, 'runCheck').length, 1);
    assert.equal(v.text('narrative-check-last'), 'Last checked 27 Oct 2026, 15:00 UTC');
  } finally { await v.close(); }
  stub({ check: async () => CHECK({ rows: [], compared: 0, mismatches: 0 }) });
  const none = await mount(check(), '/raise/investor-narrative/check?project_id=7&version=1');
  try { assert.equal(none.text('narrative-check-none'), NOTHING_COMPARED); } finally { await none.close(); }
  stub({ check: async () => CHECK({ can_check: false }) });
  const admin = await mount(check({ admin: true }), '/raise/investor-narrative/check?project_id=7&version=1');
  try { assert.ok(!admin.by('narrative-check-run') && !admin.by('narrative-check-fix-paying_customers')); } finally { await admin.close(); }
  // Not the founder, not an admin either (a cofounder): the Worker says it cannot check, so neither control is drawn.
  const team = await mount(check(), '/raise/investor-narrative/check?project_id=7&version=1');
  try { assert.ok(!team.by('narrative-check-run') && !team.by('narrative-check-fix-paying_customers')); } finally { await team.close(); }
  // A figure that agrees is OK and has nothing to fix, though it has a metric.
  stub({ check: async () => CHECK({ rows: [{ ...CHECK().rows[0], result: 'ok', differs: [] }], mismatches: 0 }) });
  const ok = await mount(check(), '/raise/investor-narrative/check?project_id=7&version=1');
  try { assert.ok(!ok.by('narrative-check-fix-paying_customers')); } finally { await ok.close(); }
});

test('NAR9: the fix is for the row clicked, carries no number, shows the check\'s figures under it, and Accept places it in Story', async () => {
  const calls = stub();
  const v = await mount(check(), '/raise/investor-narrative/check?project_id=7&version=1');
  try {
    await v.click('narrative-check-fix-paying_customers');
    assert.match(v.text('narrative-fix-dialog'), /Eadwyn’s wording carries no number/);
    assert.match(v.text('narrative-fix-figures'), /Narrative 42 Metrics 38/);
    await v.click('narrative-fix-ask');
    assert.equal(named(calls, 'zoneDraftRun')[0][0], 'raise/narrative-fix');
    assert.equal(named(calls, 'zoneDraftRun')[0][1], '7:v1:paying_customers', 'the mismatch clicked');
    assert.equal(v.text('narrative-fix-wording'), 'Bring the traction line to the measured count, or correct the record.');
    assert.match(v.text('narrative-fix-found'), /As the check found them: Paying customers: 42/);
    assert.equal(v.text('narrative-fix-accept'), 'Accept into Traction');
    await v.click('narrative-fix-accept');
    assert.equal(v.at.path, '/raise/investor-narrative/story');
    assert.equal(v.at.search, '?project_id=7&version=1&section=traction&fix=d1');
  } finally { await v.close(); }
  stub({ zoneDraftRun: async () => { throw Object.assign(new Error('the wording held a number'), { code: 'draft_unfaithful', status: 503 }); } });
  const r = await mount(check(), '/raise/investor-narrative/check?project_id=7&version=1');
  try {
    await r.click('narrative-check-fix-paying_customers');
    await r.click('narrative-fix-ask');
    assert.equal(r.text('narrative-fix-error'), 'Eadwyn’s wording held a number, so none was kept. Write the fix yourself in Story.');
  } finally { await r.close(); }
});

test('the source: Claims is mounted after Positioning, Story places a fix from ?fix=, and every write confirms in place', () => {
  const tool = read('../src/pages/raise/narrative/NarrativeTool.jsx');
  assert.match(tool, /<ClaimsTab /);
  assert.match(tool, /<CheckTab /);
  const story = read('../src/pages/raise/narrative/StoryTab.jsx');
  assert.match(story, /get\('fix'\)/);
  assert.match(story, /appendFix\(/);
  for (const f of ['ClaimsTab.jsx', 'CheckTab.jsx']) assert.doesNotMatch(read(`../src/pages/raise/narrative/${f}`), /window\.(confirm|prompt|alert)/, f);
});
