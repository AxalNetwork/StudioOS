/**
 * D912 (#2696) — the Investor narrative's Claims (NAR6), the claim lightbox
 * (NAR7, NAR7b; the phone sheet NAR19c), the check (NAR8) and Phrase the fix
 * (NAR9), on `GET /narrative/:version/claims` and `POST /narrative/:version/check`.
 * Every API is stubbed; every figure is invented.
 *
 *   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/narrative_claims_d912.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { installDocument } from './_contracts_dom.mjs';
import { CheckPanel, ClaimsTab } from '../src/pages/raise/narrative/ClaimsTab.jsx';
import {
  checkLine, claimFilters, claimRows, claimSheet, claimsLine, filterClaims, fixScopeKey, lastChecked, sourceBar, stateOf,
} from '../src/pages/raise/narrative/claimsModel.js';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const text = (n) => n.childNodes?.length ? n.childNodes.map(text).join('') : n.textContent || '';
const walk = (n) => [n, ...(n.childNodes || []).flatMap(walk)];
const props = (n) => Object.entries(n).find(([k]) => k.startsWith('__reactProps$'))?.[1] || {};
const byId = (root, id) => walk(root).find((n) => props(n)['data-testid'] === id);

const claim = (id, o = {}) => ({
  id, section: { key: 'traction', label: 'Traction' }, figure: 'MRR', kind: 'mrr', stated: '$18,400', state: 'mismatch', checked_at: '2026-10-27 10:00:00',
  source: { label: 'connector', provider: 'stripe', observed_on: '2026-10-20', record: '$16,950' }, linked: 0, note: null, note_outdated: false, ...o,
});
const READ = { version: 4, founder: true, checked_at: '2026-10-27 10:00:00', claims: [
  claim('c-back', { figure: 'Paying customers', kind: 'paying_customers', stated: '38', state: 'backed', source: { label: 'connector', provider: 'stripe', observed_on: '2026-10-20', record: '38' } }),
  claim('c-mrr'),
  claim('c-raise', { section: { key: 'ask', label: 'The ask' }, figure: 'The raise', kind: 'raise', stated: '$2,000,000', state: 'not_backed', source: null, candidates: [{ id: 'item7', kind: 'kpi-snapshot', source_label: 'connector', provider: 'stripe', observed_on: '2026-10-20' }] }),
  claim('c-typed', { section: { key: 'team', label: 'Team' }, figure: 'Headcount', kind: 'headcount', stated: '6', state: 'founders_figure', source: { label: 'typed', provider: null, observed_on: null, record: '6' } }),
] };

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('NAR6 rows: needs-you first (Mismatch, then Not backed), then the rest; a state the store does not send is Not recorded', () => {
  const rows = claimRows(READ);
  assert.deepEqual(rows.map((r) => r.id), ['c-mrr', 'c-raise', 'c-typed', 'c-back']);
  assert.deepEqual(rows.map((r) => r.needs), [true, true, false, false]);
  assert.equal(rows[1].source, 'No record');
  assert.equal(rows[0].record, '$16,950');
  assert.equal(stateOf('weird').label, 'Not recorded');
  assert.equal(claimsLine(rows), '4 claims · 2 need you');
});

test('NAR6 filters: State, Source and Section from the rows, each counted; Needs you keeps only what needs the founder', () => {
  const rows = claimRows(READ);
  const f = claimFilters(rows);
  assert.deepEqual(f.state.map((o) => [o.key, o.n]), [['mismatch', 1], ['not_backed', 1], ['founders_figure', 1], ['backed', 1]]);
  assert.deepEqual(f.source.map((o) => [o.key, o.n]).sort(), [['connector', 2], ['none', 1], ['typed', 1]]);
  assert.deepEqual(filterClaims(rows, { source: 'none' }).map((r) => r.id), ['c-raise']);
  assert.deepEqual(filterClaims(rows, { section: 'team' }).map((r) => r.id), ['c-typed']);
  // Mutation checked: ignore `needsFirst` → Backed and Founder's figure stay.
  assert.deepEqual(filterClaims(rows, { needsFirst: true }).map((r) => r.id), ['c-mrr', 'c-raise']);
});

test('NAR6 bar: by best source, a dashed "No record" of its own, widths adding to 100', () => {
  const bar = sourceBar(claimRows(READ));
  assert.deepEqual(bar.map((p) => [p.key, p.n, p.dashed]), [['connector', 2, false], ['typed', 1, false], ['none', 1, true]]);
  assert.equal(bar.reduce((n, p) => n + p.pct, 0), 100);
  assert.deepEqual(sourceBar([]), []);
});

test('NAR8 summary: counts by state, or "Nothing compared yet." with nothing compared — never "no mismatch"', () => {
  assert.equal(checkLine(claimRows(READ)), '1 mismatch · 1 not backed · 1 founder’s figure · 1 backed');
  assert.equal(checkLine([]), 'Nothing compared yet.');
  assert.equal(lastChecked(READ), 'Last checked 2026-10-27 10:00');
  assert.equal(lastChecked({ checked_at: null }), 'Not checked yet');
});

test('NAR7b Mismatch: both figures and both sources, neither presumed right; staff read no record', () => {
  const s = claimSheet(claimRows(READ)[0], 4, '?project_id=3');
  assert.equal(s.kind, 'mismatch');
  assert.deepEqual(s.stated, { value: '$18,400', where: 'The narrative, v4, Traction' });
  assert.deepEqual(s.record, { value: '$16,950', where: 'Connector · stripe · 2026-10-20' });
  assert.equal(s.useRecord, '/raise/investor-narrative/story?project_id=3&version=4');
  assert.equal(s.canNote, true);
  const staff = claimSheet(claimRows({ ...READ, founder: false, claims: [claim('x', { source: { label: 'connector', provider: 'stripe', observed_on: '2026-10-20' } })] })[0], 4);
  assert.equal(staff.record, null);
  assert.equal(staff.canNote, false, 'no record figure, no note against it');
});

test('NAR7 Not backed: the records that could back it, and Link a record on Evidence; the fix scope names the claim', () => {
  const s = claimSheet(claimRows(READ)[1], 4);
  assert.equal(s.kind, 'not_backed');
  assert.deepEqual(s.candidates.map((c) => c.id), ['item7']);
  assert.equal(s.evidence, '/raise/evidence/claim/c-raise');
  assert.equal(fixScopeKey(7, 'c-mrr'), '7|c-mrr');
});

/* ------------------------------------------------------------------ *
 * Mounted
 * ------------------------------------------------------------------ */

function stubApi(o = {}) {
  const calls = [];
  const rec = (name, value) => (...a) => { calls.push([name, ...a]); return typeof value === 'function' ? value(...a) : Promise.resolve(value); };
  return {
    calls,
    api: {
      narrative: { claims: rec('claims', o.claims ?? READ), runCheck: rec('runCheck', READ) },
      evidence: { note: rec('note', { ok: true }), clearNote: rec('clearNote', { ok: true }) },
      app: {
        zoneDraftRun: rec('zoneDraftRun', o.draft ?? { item: { uid: 'd1', body: 'Bring the narrative to the stored figure, or correct the stored metric if yours is current.\n\nAs the check found them: MRR: $18,400 in the narrative, $16,950 in Connector.' } }),
        zoneDraftAccept: rec('zoneDraftAccept', { ok: true }),
      },
    },
  };
}

async function mount(el) {
  const restore = installDocument();
  const create = document.createElement.bind(document);
  document.createElement = (tag) => { const n = create(tag); n.querySelector = () => null; n.querySelectorAll = () => []; n.focus = () => {}; return n; };
  document.body.style = { overflow: 'auto', paddingRight: '' };
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, null, el)));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { container, async done() { await act(async () => root.unmount()); restore(); } };
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = async (n) => act(async () => { await props(n).onClick?.({ preventDefault() {} }); await new Promise((r) => setTimeout(r, 0)); });
const change = async (n, target) => act(async () => { await props(n).onChange?.({ target }); await new Promise((r) => setTimeout(r, 0)); });

test('Claims mounted: the bar, the filters, needs-you first; a Mismatch opens both figures; Keep mine writes only after its form', async () => {
  const { api, calls } = stubApi();
  const w = await mount(React.createElement(ClaimsTab, { projectId: 3, version: 4, search: '?project_id=3', api }));
  try {
    assert.deepEqual(calls[0], ['claims', 3, 4]);
    assert.match(text(byId(w.container, 'claims-line')), /4 claims · 2 need you/);
    assert.ok(byId(w.container, 'claims-bar-none'), 'a dashed segment for claims with no record');
    await change(byId(w.container, 'claims-needs'), { checked: true });
    assert.equal(byId(w.container, 'claim-row-c-back'), undefined);
    await click(byId(w.container, 'claim-row-c-mrr'));
    assert.match(text(byId(w.container, 'claim-stated')), /\$18,400/);
    assert.match(text(byId(w.container, 'claim-record')), /\$16,950/);
    await click(byId(w.container, 'claim-keep'));
    assert.equal(calls.filter((c) => c[0] === 'note').length, 0, 'Keep mine asks why first');
    assert.equal(props(byId(w.container, 'claim-note-save')).disabled, true, 'no reason, no note');
    await change(byId(w.container, 'claim-note-input'), { value: 'Our count includes annual pilots.' });
    await click(byId(w.container, 'claim-note-save'));
    assert.deepEqual(calls.find((c) => c[0] === 'note').slice(1), [3, 'c-mrr', 'Our count includes annual pilots.']);
    assert.equal(calls.filter((c) => c[0] === 'claims').length, 2, 'the claims are read again after the note');
  } finally { await w.done(); }
});

test('Claims mounted: Not backed lists the records that could back it; none reads "No records to back a claim yet" (NAR15c)', async () => {
  const { api } = stubApi();
  const w = await mount(React.createElement(ClaimsTab, { projectId: 3, version: 4, api }));
  try {
    await click(byId(w.container, 'claim-row-c-raise'));
    assert.ok(byId(w.container, 'claim-candidate-item7'));
    assert.equal(props(byId(w.container, 'claim-link')).href, '/raise/evidence/claim/c-raise');
  } finally { await w.done(); }
  const none = stubApi({ claims: { ...READ, claims: [READ.claims[2] && { ...READ.claims[2], candidates: [] }] } });
  const n = await mount(React.createElement(ClaimsTab, { projectId: 3, version: 4, api: none.api }));
  try {
    await click(byId(n.container, 'claim-row-c-raise'));
    assert.match(text(byId(n.container, 'claim-no-records')), /No records to back a claim yet/);
  } finally { await n.done(); }
});

test('Claims mounted: an unreadable store says so (NAR17a); an empty, unchecked version says it has not been checked', async () => {
  const broken = stubApi({ claims: () => Promise.reject(Object.assign(new Error('x'), { status: 503 })) });
  let w = await mount(React.createElement(ClaimsTab, { projectId: 3, version: 4, api: broken.api }));
  try { assert.match(text(w.container), /could not be read/); } finally { await w.done(); }
  w = await mount(React.createElement(ClaimsTab, { projectId: 3, version: 4, api: stubApi({ claims: { version: 4, founder: true, checked_at: null, claims: [] } }).api }));
  try { assert.match(text(byId(w.container, 'claims-none')), /has not been checked yet/); } finally { await w.done(); }
});

test('Check mounted: Run the check re-reads; Phrase the fix runs on the clicked claim and keeps a wording only on press', async () => {
  const { api, calls } = stubApi();
  const w = await mount(React.createElement(CheckPanel, { projectId: 3, version: 4, api }));
  try {
    assert.match(text(byId(w.container, 'narrative-check-summary')), /1 mismatch/);
    await click(byId(w.container, 'narrative-check-run'));
    assert.deepEqual(calls.find((c) => c[0] === 'runCheck').slice(1), [3, 4]);
    await settle();
    await click(byId(w.container, 'check-fix-c-mrr'));
    assert.equal(calls.filter((c) => c[0] === 'zoneDraftRun').length, 0, 'the fix runs only on its own press');
    await click(byId(w.container, 'fix-run'));
    // Mutation checked: send the project alone → Eadwyn phrases the newest version's first mismatch instead.
    assert.deepEqual(calls.find((c) => c[0] === 'zoneDraftRun').slice(1, 3), ['raise/narrative-fix', '3|c-mrr']);
    assert.match(text(byId(w.container, 'fix-draft')), /As the check found them/);
    await click(byId(w.container, 'fix-keep'));
    assert.deepEqual(calls.find((c) => c[0] === 'zoneDraftAccept').slice(1), ['d1']);
  } finally { await w.done(); }
  const refused = stubApi({ draft: () => Promise.reject(Object.assign(new Error('draft_unfaithful'), { status: 503, code: 'draft_unfaithful' })) });
  const r = await mount(React.createElement(CheckPanel, { projectId: 3, version: 4, api: refused.api }));
  try {
    await click(byId(r.container, 'check-fix-c-mrr'));
    await click(byId(r.container, 'fix-run'));
    assert.match(text(byId(r.container, 'fix-none')), /stated a number/, 'a numbered wording is no wording, said plainly');
  } finally { await r.done(); }
  const empty = await mount(React.createElement(CheckPanel, { projectId: 3, version: 4, api: stubApi({ claims: { version: 4, founder: true, checked_at: null, claims: [] } }).api }));
  try { assert.match(text(byId(empty.container, 'narrative-check-none')), /Nothing compared yet\./); } finally { await empty.done(); }
});

test('the house rules on the new files', () => {
  const src = ['ClaimsTab.jsx', 'claimsModel.js'].map((f) => read(`frontend/src/pages/raise/narrative/${f}`)).join('\n');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /window\.(alert|confirm|prompt)\(/);
  assert.doesNotMatch(code, /\b(advisor|advice|recommendation)s?\b/i);
  assert.doesNotMatch(code, /Northwind|\[\$/, 'no canvas sample');
  for (const m of code.matchAll(/['`"]((?:[^'`"]*\s)?hover:(?:bg|text|border)-[^'`"]*)['`"]/g)) {
    assert.match(m[1], /dark:hover:/, m[1].slice(0, 90));
  }
  const api = read('frontend/src/lib/api/narrative.js');
  assert.match(api, /claims: \(projectId, version\) => request\(`\/cycles\/raise\/narrative\/\$\{enc\(version\)\}\/claims\?project=/);
  assert.match(read('cloudflare-worker/src/routes/cycle_raise.ts'), /cycleRaise\.get\('\/narrative\/:version\/claims'/);
});
