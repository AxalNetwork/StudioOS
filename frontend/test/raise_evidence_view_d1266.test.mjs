// D1266 (#3289) — Raise evidence part 5: the founder's Evidence view live from
// GET /api/cycles/raise/evidence (VR1), its claim and item drawers (VR2, VR3),
// Waiting for review with Accept all capped at 50 (VR4), the Share dialog (VR5),
// See as an investor (VR11), the admin's read-only view (VR12), and the empty,
// loading, error, partial and refused states (VR13–VR16).
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_evidence_view_d1266.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { EvidenceBody } from '../src/pages/cycles/evidence/RaiseEvidence.jsx';
import { ShareDialog, SharedView } from '../src/pages/cycles/evidence/EvidenceReview.jsx';
import { viewOf } from '../src/pages/cycles/evidence/evidenceModel.js';
import {
  ACCEPT_ALL_CAP, acceptAllOffer, acceptAllPlan, claimTitle, claimWhere, countOf, coverageByArea, day, figure, filterClaims,
  investorsSee, needRank, outcomeWord, sharingChange, statedFigure, viewModel,
} from '../src/pages/cycles/evidence/evidenceView.js';

const h = React.createElement;
const read = (p) => readFileSync(p, 'utf8');
const html = (el, path = '/raise/evidence') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const count = (out, s) => out.split(s).length - 1;

const item = (uid, o = {}) => ({ uid, id: 1, area: 'Investor narrative and Pitch deck', kind: 'kpi-snapshot', source_label: 'connector', provider: 'stripe', strength: 'measured', observed_on: '2026-09-30', summary: 'A dated KPI value is recorded.', state: 'pinned', visibility: 'after_nda', version: 1, private_reason: null, value_num: 16950, value_unit: 'money', currency: 'usd', source_state: 'recorded', stale: false, date_reason: null, snapshot_hash: 'a'.repeat(64), ...o });
const claim = (uid, state, o = {}) => ({ uid, surface: 'narrative', surface_version: 'v3', field_key: 'traction#mrr', claim_kind: 'mrr', stated_value: '18400', state, checked_at: '2026-10-09 14:02:00', record: null, links: [], ...o });
const proposal = (uid, o = {}) => ({ uid, area: 'Fundraising readiness', kind: 'bank-runway', source_label: 'connector', provider: 'mercury', strength: 'measured', observed_on: '2026-10-01', summary: 'Runway derived from the company bank is recorded.', status: 'proposed', can_accept: true, snapshot_hash: 'b'.repeat(64), source_state: 'recorded', value_num: 14.2, value_unit: 'months', currency: null, stale: false, ...o });
function fixture() {
  return {
    items: { state: 'recorded', has_more: false, rows: [
      item('kpi'), item('typed', { source_label: 'typed', provider: null, value_num: 18400 }),
      item('runway', { area: 'Fundraising readiness', kind: 'bank-runway', provider: 'mercury', private_reason: 'bank', value_num: 14.2, value_unit: 'months', visibility: 'private' }),
      item('loi', { area: 'Data room', kind: 'loi-file', source_label: 'document', provider: null, value_num: null, value_unit: null, visibility: 'summary', source_state: 'changed', stale: true }),
    ] },
    proposals: { state: 'recorded', has_more: false, rows: [proposal('p1'), proposal('p2', { kind: 'roadmap-release', provider: 'github' }), proposal('p3', { can_accept: false, source_state: 'changed', snapshot_hash: null })] },
    claims: { state: 'recorded', has_more: false, rows: [
      claim('c-backed', 'backed', { field_key: 'traction#paying_customers', claim_kind: 'paying_customers', stated_value: '42', record: { value: 42, shown: '42', stated_shown: '42', source_label: 'connector', provider: 'stripe', observed_on: '2026-09-30', items: ['kpi'] }, links: [{ item_uid: 'kpi', how: 'computed' }] }),
      claim('c-typed', 'founders_figure', { field_key: 'why#arr', claim_kind: 'arr', stated_value: '220800', record: { value: 220800, shown: '$220,800', stated_shown: '$220,800', source_label: 'typed', provider: null, observed_on: '2026-09-01', items: ['typed'] }, links: [{ item_uid: 'typed', how: 'computed' }] }),
      claim('c-mismatch', 'mismatch', { record: { value: 16950, shown: '$16,950', stated_shown: '$18,400', source_label: 'connector', provider: 'stripe', observed_on: '2026-09-30', items: ['kpi'] }, links: [{ item_uid: 'kpi', how: 'computed' }, { item_uid: 'typed', how: 'founder' }] }),
      claim('c-none', 'not_backed', { surface: 'deck', surface_version: 'v4', field_key: 'slide:5#pilots', claim_kind: 'pilots', stated_value: '16' }),
      claim('c-runway', 'backed', { surface: 'readiness', surface_version: 'current', field_key: 'traction', claim_kind: 'traction_proof', stated_value: null, record: { value: null, shown: null, stated_shown: null, source_label: 'connector', provider: 'mercury', observed_on: '2026-10-01', items: ['runway'] } }),
    ] },
    coverage: { state: 'recorded', groups: [
      { area: 'Investor narrative and Pitch deck', source_label: 'connector', state: 'pinned', visibility: 'after_nda', count: 3 },
      { area: 'Investor narrative and Pitch deck', source_label: 'typed', state: 'pinned', visibility: 'after_nda', count: 1 },
      { area: 'Data room', source_label: 'document', state: 'pinned', visibility: 'summary', count: 2 },
      { area: 'Fundraising readiness', source_label: 'connector', state: 'pinned', visibility: 'private', count: 1 },
      { area: 'Legal', source_label: 'signed', state: 'unpinned', visibility: 'after_nda', count: 4 },
    ] },
    opens: { state: 'recorded', days: 30, count: 3, investors: 2, capped: false, rows: [{ investor: 'Lumen Ventures', at: '2026-10-09 10:00:00' }, { investor: 'Harbor Seed Fund', at: '2026-10-08 09:00:00' }, { investor: 'Lumen Ventures', at: '2026-10-02 08:00:00' }] },
    live_sources: [{ dataset: 'bank', state: 'unreadable', count: null }, { dataset: 'metrics', state: 'recorded', count: 2 }],
    claim_check: { outcome: 'recorded', surfaces: [] },
    permissions: { can_decide: true, can_share: true },
  };
}
const ready = (r = fixture()) => ({ status: 'ready', read: r });
const body = (props, path) => html(h(EvidenceBody, { view: viewOf(path || '/raise/evidence'), projectId: 7, search: '?project_id=7', ...props }), path);

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

test('the addresses: the view, the review queue, the preview and the drawers', () => {
  assert.deepEqual(viewOf('/raise/evidence'), { page: 'view', drawer: null, id: null });
  assert.deepEqual(viewOf('/raise/evidence/review'), { page: 'review', drawer: null, id: null });
  assert.deepEqual(viewOf('/raise/evidence/preview/'), { page: 'preview', drawer: null, id: null });
  assert.deepEqual(viewOf('/raise/evidence/claim/c-1'), { page: 'view', drawer: 'claim', id: 'c-1' });
  assert.deepEqual(viewOf('/raise/evidence/reviewer'), { page: 'view', drawer: null, id: null });
});

test('the tiles count what the read holds: Typed-only is never Backed, a page with more says +, a failed block is no zero', () => {
  const m = viewModel(fixture());
  assert.deepEqual([m.tiles.backed, m.tiles.founders, m.tiles.mismatch, m.tiles.notBacked, m.tiles.total], [2, 1, 1, 1, 5]);
  assert.equal(m.tiles.afterNda, 4, 'pinned After NDA items only; an unpinned group is not shared');
  assert.equal(m.tiles.summary, 2);
  assert.deepEqual([m.tiles.waiting, m.tiles.opens, m.tiles.openers], [3, 3, 2]);
  assert.equal(countOf(100, true), '100+'); assert.equal(countOf(5, false), '5'); assert.equal(countOf(null, false), null);
  const r = fixture(); r.claims = { state: 'unreadable', rows: null, reason: 'x' }; r.opens = { state: 'unreadable', count: null };
  const failed = viewModel(r);
  assert.deepEqual([failed.tiles.backed, failed.tiles.total, failed.tiles.opens], [null, null, null], 'Unreadable, never 0');
  assert.deepEqual(m.unreadableSources, ['Mercury']);
  assert.equal(m.empty, false);
  assert.equal(viewModel({ ...fixture(), items: { state: 'recorded', rows: [] }, proposals: { state: 'recorded', rows: [] }, claims: { state: 'recorded', rows: [] } }).empty, true);
});

test('claims: Needs you first, the filters, and their words', () => {
  const m = viewModel(fixture());
  assert.deepEqual(filterClaims(m.claims, m.byUid).map((c) => c.uid).slice(0, 2), ['c-mismatch', 'c-none']);
  assert.equal(needRank({ state: 'backed', record: { items: ['loi'] } }, m.byUid), 2, 'a changed record comes before the rest');
  assert.deepEqual(filterClaims(m.claims, m.byUid, { state: 'founders_figure' }).map((c) => c.uid), ['c-typed']);
  assert.deepEqual(filterClaims(m.claims, m.byUid, { source: 'typed' }).map((c) => c.uid), ['c-typed']);
  assert.deepEqual(filterClaims(m.claims, m.byUid, { sharing: 'private' }).map((c) => c.uid), ['c-runway']);
  assert.deepEqual(filterClaims(m.claims, m.byUid, { q: 'pilots' }).map((c) => c.uid), ['c-none']);
  assert.equal(claimTitle(m.claims[2]), 'MRR'); assert.equal(claimWhere(m.claims[2]), 'Investor narrative · v3');
  assert.equal(claimWhere(m.claims[3]), 'Pitch deck · v4 · slide 5');
  assert.equal(statedFigure(m.claims[2]), '$18,400'); assert.equal(statedFigure(m.claims[3]), '16');
  assert.equal(figure(123400, 'cents'), '$1,234'); assert.equal(figure(14.2, 'months'), '14.2 months'); assert.equal(figure(null, 'money'), null);
  assert.equal(figure(0, 'money'), '$0', 'a recorded zero is a zero'); assert.equal(day('2026-10-03 12:00:00'), '3 Oct 2026'); assert.equal(day(null), null);
});

test('coverage and what investors see read pinned items only, by source', () => {
  const rows = coverageByArea(fixture().coverage.groups);
  const narrative = rows.find((r) => r.area === 'Investor narrative and Pitch deck');
  assert.deepEqual([narrative.total, narrative.by.connector, narrative.by.typed], [4, 3, 1]);
  assert.equal(rows.find((r) => r.area === 'Legal').total, 0, 'an unpinned item covers nothing');
  assert.deepEqual(investorsSee(fixture().coverage.groups), { shared: 6, withValues: 4, summary: 2 });
  assert.equal(investorsSee(null), null);
});

test('Accept all: one source, at most 50 a press, only what can be accepted now; each outcome in words', () => {
  const many = Array.from({ length: 60 }, (_, n) => proposal(`m${n}`));
  const plan = acceptAllPlan([...many, proposal('x', { can_accept: false }), proposal('g', { provider: 'github' })], { source: 'connector', provider: 'mercury' });
  assert.equal(ACCEPT_ALL_CAP, 50);
  assert.deepEqual([plan.take.length, plan.left, plan.notReady], [50, 10, 1]);
  assert.deepEqual(acceptAllOffer(fixture().proposals.rows), { source: 'connector', provider: 'mercury', count: 1, label: 'Accept all from Connector · Mercury' });
  assert.equal(acceptAllOffer([proposal('z', { can_accept: false })]), null);
  assert.equal(outcomeWord({ ok: true }), 'Accepted'); assert.equal(outcomeWord({ ok: false, code: 'decided' }), 'Already decided');
  assert.match(outcomeWord({ ok: false, code: 'changed' }), /Look again/);
});

test('a sharing change says what it changes; a bank item is a figure only', () => {
  const c = sharingChange(item('runway', { private_reason: 'bank', kind: 'bank-runway' }), 'after_nda');
  assert.equal(c.title, 'Share as After NDA?');
  assert.match(c.says, /Runway from the bank becomes After NDA\. Before an NDA investors see its kind, source and date; after it, its figure too\. It is shared as a figure only: balances, accounts and bank lines are never shown\./);
  assert.doesNotMatch(sharingChange(item('runway', { private_reason: 'bank' }), 'private').says, /figure only/);
  assert.equal(sharingChange(item('kpi'), 'everyone'), null);
});

/* ------------------------------------------------------------------ *
 * Rendered
 * ------------------------------------------------------------------ */

test('VR1: tiles, claims by area with states and sources, pinned evidence, review, coverage, investors and opens', () => {
  const out = body({ state: ready() });
  for (const id of ['evidence-tiles', 'evidence-claims', 'evidence-items', 'evidence-review-card', 'evidence-coverage', 'evidence-investors-see', 'evidence-opens']) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.ok(out.includes('Claims backed') && out.includes('>2 of 5<'));
  assert.equal(count(out, 'data-testid="evidence-claim"'), 5);
  assert.equal(count(out, 'data-state="founders_figure"'), 2, 'the row and its pill');
  assert.ok(out.includes('Founder’s figure'));
  assert.ok(out.includes('$18,400 stated · $16,950 in the record'), 'a mismatch names both figures');
  assert.ok(out.includes('No record of this kind on StudioOS'), 'a claim with no record');
  assert.ok(out.includes('href="/raise/evidence/claim/c-mismatch?project_id=7"'));
  assert.ok(out.includes('href="/raise/evidence/item/kpi?project_id=7"'));
  assert.ok(out.includes('data-testid="evidence-changed"') && out.includes('data-testid="evidence-stale"'));
  assert.ok(out.includes('Mercury could not be read. Its items show their last known date.'));
  assert.ok(out.includes('href="/raise/evidence/review?project_id=7"') && out.includes('href="/raise/evidence/preview?project_id=7"'));
  assert.ok(out.includes('<strong>Lumen Ventures</strong> opened the evidence'));
  assert.ok(!out.includes('Not read here yet'), 'no wait left on the founder’s view');
  assert.ok(!out.includes('evidence-wait-'));
});

test('VR2: the claim drawer shows both figures and both sources; Typed-only says why it is not Backed', () => {
  const out = body({ state: ready() }, '/raise/evidence/claim/c-mismatch');
  assert.ok(out.includes('data-testid="evidence-drawer-claim"'));
  assert.match(out, /You state<\/span><span[^>]*data-testid="claim-stated">\$18,400</);
  assert.match(out, /data-testid="claim-record">\$16,950</);
  assert.ok(out.includes('Neither figure is presumed right.'));
  assert.ok(out.includes('Linked by you') && out.includes('Found by the check'));
  assert.equal(count(out, 'data-testid="claim-unlink"'), 1, 'a computed link is the check’s and is not unlinked by hand');
  assert.ok(out.includes('href="/raise/evidence?project_id=7"'), 'close keeps the venture');
  const typed = body({ state: ready() }, '/raise/evidence/claim/c-typed');
  assert.ok(typed.includes('Only a figure you typed agrees, so this is your figure, not Backed.'));
  assert.ok(body({ state: ready() }, '/raise/evidence/claim/gone').includes('data-testid="evidence-drawer-claim-missing"'));
});

test('VR3: the item drawer — source, date, backs, sharing, Confirm for a changed source, Unpin', () => {
  const kpi = body({ state: ready() }, '/raise/evidence/item/kpi');
  assert.ok(kpi.includes('data-testid="evidence-drawer-item"') && kpi.includes('KPI snapshot'));
  assert.ok(kpi.includes('Dated 30 Sep 2026, the record’s own date.'));
  assert.ok(kpi.includes('href="/raise/evidence/claim/c-backed?project_id=7"'), 'what it backs');
  assert.match(kpi, /data-testid="item-share-after_nda"[^>]*>|aria-checked="true"[^>]*data-testid="item-share-after_nda"/);
  assert.ok(kpi.includes('data-testid="item-unpin"'));
  const loi = body({ state: ready() }, '/raise/evidence/item/loi');
  assert.ok(loi.includes('data-testid="item-confirm"') && loi.includes('Investors see nothing of it until you confirm'));
  const runway = body({ state: ready() }, '/raise/evidence/item/runway');
  assert.ok(runway.includes('balances, accounts and bank lines are never shown'));
});

test('VR4: the queue — filters, Accept all from one source, per-row Accept and Dismiss; a changed one cannot be accepted', () => {
  const out = body({ state: ready() }, '/raise/evidence/review');
  assert.ok(out.includes('data-testid="evidence-review"'));
  assert.ok(out.includes('Accept all from Connector · Mercury [1]'));
  assert.ok(out.includes('At most 50 per press. Each outcome is listed after.'));
  assert.equal(count(out, 'data-testid="evidence-proposal"'), 3);
  assert.match(out, /disabled=""[^>]*data-testid="proposal-accept"/, 'a changed proposal’s Accept is disabled');
  assert.ok(out.includes('Look again to accept the current record'));
  assert.ok(out.includes('href="/raise/evidence?project_id=7"'));
});

test('VR5: sharing opens a dialog naming what investors see before and after the NDA, and who can see it now', () => {
  const items = [item('kpi'), item('runway', { kind: 'bank-runway', private_reason: 'bank', value_num: 14.2, value_unit: 'months' })];
  const out = html(h(ShareDialog, { items, projectId: 7, onClose() {} }));
  assert.ok(out.includes('role="dialog"'), 'an in-page dialog, never a browser pop-up');
  assert.ok(out.includes('Share 2 items') && out.includes('All 2 become After NDA.'));
  assert.ok(out.includes('data-testid="share-before"') && out.includes('Connector · KPI snapshot · 30 Sep 2026'));
  assert.ok(out.includes('Runway from the bank · 14.2 months'), 'after the NDA, the figure');
  assert.ok(out.includes('data-testid="share-who"') && out.includes('Reading who can see it…'));
  assert.ok(out.includes('Bank-derived items are shared as a figure only.'));
});

test('VR11: See as an investor draws the investor’s projection; before the NDA coverage only', () => {
  const after = html(h(SharedView, { r: { nda_signed: true, coverage: { state: 'recorded', groups: [{ area: 'Data room', kind: 'loi-file', source_label: 'document', count: 3, newest: '2026-09-28' }] },
    items: { state: 'recorded', rows: [{ uid: 'i', kind: 'kpi-snapshot', source_label: 'connector', provider: 'stripe', strength: 'measured', observed_on: '2026-09-30', sharing: 'summary', value_num: null, value_reason: 'Shared as a summary only.' }] },
    claims: { state: 'recorded', rows: [{ uid: 'c', state: 'mismatch', items: ['i'] }] }, partial: false } }));
  assert.ok(after.includes('Shared as a summary only.') && after.includes('Backs a claim:') && after.includes('Mismatch'));
  assert.ok(after.includes('newest 28 Sep 2026'));
  const before = html(h(SharedView, { r: { nda_signed: false, before_nda: 'Figures, files and quotes open once the NDA is signed.', coverage: { state: 'recorded', groups: [] }, items: null, claims: null } }));
  assert.ok(before.includes('Figures, files and quotes open once the NDA is signed.') && !before.includes('data-testid="shared-items"'));
  assert.ok(before.includes('Nothing is shared with investors yet.'));
  const page = body({ state: ready() }, '/raise/evidence/preview');
  assert.ok(page.includes('data-testid="evidence-preview"') && page.includes('A preview is not logged as an open.'));
});

test('VR12: an admin reads with no control; VR16: a refused reader; the preview is the founder’s', () => {
  const r = fixture(); r.permissions = { can_decide: false, can_share: false };
  const out = body({ state: ready(r) });
  assert.ok(out.includes('You are viewing this venture’s evidence as a studio admin.'));
  for (const id of ['items-share', 'evidence-review-card', 'see-as-investor', 'proposal-accept']) assert.ok(!out.includes(`data-testid="${id}"`), id);
  const drawer = body({ state: ready(r) }, '/raise/evidence/item/kpi');
  assert.ok(!drawer.includes('item-unpin') && !drawer.includes('item-share-after_nda') && drawer.includes('data-sharing="after_nda"'));
  assert.ok(body({ state: ready(r) }, '/raise/evidence/preview').includes('data-testid="evidence-forbidden"'));
  assert.ok(body({ state: { status: 'forbidden' } }).includes('Evidence is for the venture’s founders and the investors they invite.'));
});

test('VR13–VR15: empty, loading, an error that is not the same as none, and one failed block that blanks nothing', () => {
  const empty = fixture(); empty.items = { state: 'recorded', rows: [] }; empty.proposals = { state: 'recorded', rows: [] }; empty.claims = { state: 'recorded', rows: [] };
  empty.opens = { state: 'recorded', count: 0, investors: 0, rows: [] };
  const e = body({ state: ready(empty) });
  assert.ok(e.includes('Nothing backs your Raise yet.') && e.includes('href="/validate/record?project_id=7"'));
  assert.ok(e.includes('No investor has opened your evidence yet.'));
  assert.ok(body({ state: { status: 'loading' } }).includes('data-testid="evidence-loading"'));
  const err = body({ state: { status: 'error', message: '' } });
  assert.ok(err.includes('Your evidence could not be read.') && err.includes('That is not the same as having none.') && err.includes('Try again'));
  const partial = fixture(); partial.coverage = { state: 'unreadable', groups: null, reason: 'Coverage could not be read. Try again.' };
  partial.opens = { state: 'unreadable', count: null, rows: null, reason: 'Investor opens could not be read. Try again.' };
  const p = body({ state: ready(partial) });
  assert.ok(p.includes('data-testid="evidence-unreadable-coverage"') && p.includes('data-testid="evidence-unreadable-opens"'));
  assert.equal(count(p, 'data-testid="evidence-claim"'), 5, 'the claims still draw');
  assert.ok(!/Investor opens, 30 days<\/span><span[^>]*>0</.test(p), 'never a zero for an unreadable count');
});

/* ------------------------------------------------------------------ *
 * The house rules, in the source
 * ------------------------------------------------------------------ */

test('the source: no browser pop-up, every light hover has its dark pair, the read through the client, the routes', () => {
  const files = ['RaiseEvidence.jsx', 'EvidenceView.jsx', 'EvidenceDrawers.jsx', 'EvidenceReview.jsx', 'EvidenceParts.jsx', 'evidenceView.js'].map((f) => read(`frontend/src/pages/cycles/evidence/${f}`));
  for (const src of files) {
    assert.ok(!/\b(window\.)?(alert|confirm|prompt)\(/.test(src), 'no browser pop-up');
    for (const cls of src.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) || []) {
      const light = (cls.match(/(?<![:\w-])hover:(bg|text|border)-/g) || []).length;
      const dark = (cls.match(/dark:hover:(bg|text|border)-/g) || []).length;
      assert.ok(light <= dark, `a light hover with no dark pair: ${cls}`);
    }
    assert.ok(!/fetch\(/.test(src), 'every read goes through lib/api');
  }
  const consts = read('frontend/src/pages/cycles/evidence/EvidenceParts.jsx').match(/export const BTN_[A-Z] = `[^`]*`/g);
  for (const c of consts) if (/(?<![:\w-])hover:bg-/.test(c)) assert.ok(/dark:hover:bg-/.test(c), c);
  const app = read('frontend/src/App.jsx');
  for (const p of ['/raise/evidence/review', '/raise/evidence/preview']) {
    assert.ok(app.includes(`<Route path="${p}" element={guard(labRoles(['admin', 'founder']), <RaiseEvidence />)} />`), p);
    assert.ok(app.indexOf(`path="${p}"`) < app.indexOf('path="/raise/:slug"'));
  }
});
