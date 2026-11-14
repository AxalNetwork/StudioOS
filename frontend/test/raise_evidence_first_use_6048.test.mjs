// D6048 (#6048) — Raise v2 build 4/5: Evidence's first use (RA-15b founder, RA-15c admin viewer), the Home in
// RA-15's order, each claim a card with one action at phone width (RA-26a), and the page-level hand-off to
// Fundraising readiness. Forbidden, error and partial-source states are unchanged.
//
// Run with:
//   node --import ./frontend/test/_deck-loader.mjs --test frontend/test/raise_evidence_first_use_6048.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { EvidenceBody } from '../src/pages/cycles/evidence/RaiseEvidence.jsx';
import { viewOf } from '../src/pages/cycles/evidence/evidenceModel.js';
import { claimAction, viewModel } from '../src/pages/cycles/evidence/evidenceView.js';

const h = React.createElement;
const html = (el, path = '/raise/evidence') => renderToStaticMarkup(h(MemoryRouter, { initialEntries: [path] }, el));
const body = (r, path = '/raise/evidence') => html(h(EvidenceBody, { state: { status: 'ready', read: r }, view: viewOf(path), projectId: 7, search: '?project_id=7' }), path);
const has = (out, id) => out.includes(`data-testid="${id}"`);
const count = (out, s) => out.split(s).length - 1;

const none = () => ({ state: 'recorded', rows: [], has_more: false });
const item = (uid, o = {}) => ({ uid, area: 'Data room', kind: 'loi-file', source_label: 'document', provider: null, strength: 'pattern', observed_on: '2026-10-01', state: 'pinned', visibility: 'summary', source_state: 'recorded', stale: false, ...o });
const claim = (uid, state, o = {}) => ({ uid, surface: 'narrative', surface_version: 'v3', field_key: 'traction#mrr', claim_kind: 'mrr', stated_value: '18400', state, checked_at: '2026-10-09 14:02:00', record: null, links: [], ...o });
function emptyRead({ founder = true } = {}) {
  return {
    items: none(), proposals: none(), claims: none(),
    coverage: { state: 'recorded', groups: [] },
    opens: { state: 'recorded', days: 30, count: 0, investors: 0, rows: [] },
    live_sources: founder ? [] : null,
    claim_check: founder ? { outcome: 'recorded', surfaces: [] } : null,
    permissions: { can_decide: founder, can_share: founder },
  };
}
function fullRead({ founder = true } = {}) {
  const r = emptyRead({ founder });
  r.items = { state: 'recorded', has_more: false, rows: [item('fresh'), item('moved', { source_state: 'changed' }), item('old', { stale: true })] };
  r.coverage = { state: 'recorded', groups: [{ area: 'Data room', source_label: 'document', state: 'pinned', visibility: 'summary', count: 3 }] };
  r.claims = { state: 'recorded', has_more: false, rows: [
    claim('c-mm', 'mismatch'), claim('c-nb', 'not_backed'), claim('c-ff', 'founders_figure'),
    claim('c-ok', 'backed', { record: { items: ['fresh'], source_label: 'document' } }),
    claim('c-ch', 'backed', { record: { items: ['moved'], source_label: 'document' } }),
  ] };
  return r;
}
const DASHBOARD = ['evidence-tiles', 'evidence-claims', 'claims-filter-state', 'claims-filter-source', 'claims-filter-sharing', 'evidence-coverage', 'evidence-items', 'evidence-opens', 'evidence-investors-see'];

test('RA-15b: a founder with no claim and no item gets Build your evidence base, its three actions and no dashboard', () => {
  const out = body(emptyRead());
  assert.ok(out.includes('data-mode="first-use"'));
  assert.ok(has(out, 'evidence-empty') && out.includes('Build your evidence base'));
  assert.ok(out.includes('href="/build/connect?project_id=7"'), 'connect a source');
  assert.ok(out.includes('href="/validate/record?project_id=7"'), 'record a session');
  assert.ok(out.includes('href="/validate?project_id=7"') && out.includes('Open Validate records'), 'open Validate records');
  for (const id of DASHBOARD) assert.ok(!has(out, id), `not drawn on first use: ${id}`);
  assert.ok(!/>0</.test(out), 'no zero anywhere');
  assert.ok(out.includes('href="/raise/fundraising-readiness?project_id=7"'), 'the page-level hand-off');
  assert.ok(!has(out, 'evidence-admin-empty'));
});

test('RA-15c: an admin viewer of the same read sees no visible evidence, no setup actions and no dashboard', () => {
  const out = body(emptyRead({ founder: false }));
  assert.ok(has(out, 'evidence-admin-empty') && out.includes('This venture has no visible evidence yet.'));
  assert.ok(has(out, 'evidence-admin'), 'the admin banner stays (VR12)');
  assert.ok(!has(out, 'evidence-empty') && !has(out, 'evidence-setup') && !out.includes('href="/build/connect'));
  for (const id of DASHBOARD) assert.ok(!has(out, id), `not drawn for the admin: ${id}`);
});

test('a block that could not be read is never first use; a source that could not be read still says so', () => {
  const unreadItems = emptyRead(); unreadItems.items = { state: 'unreadable', reason: 'Evidence could not be read.' };
  const a = body(unreadItems);
  assert.ok(a.includes('data-mode="home"') && has(a, 'evidence-unreadable-items') && !has(a, 'evidence-empty'));
  const unchecked = emptyRead(); unchecked.claim_check = { outcome: 'unreadable', reason: 'Claims could not be checked. Try again.' };
  assert.equal(viewModel(unchecked).empty, false, 'a failed claim check is not "no claims"');
  assert.ok(has(body(unchecked), 'evidence-unreadable-claim-check'));
  const waiting = emptyRead(); waiting.proposals = { state: 'recorded', has_more: false, rows: [{ uid: 'p', area: 'Data room', kind: 'loi-file', source_label: 'document', can_accept: true, snapshot_hash: 'a'.repeat(64) }] };
  assert.ok(has(body(waiting), 'evidence-review-card'), 'something waiting for review keeps the dashboard');
  const partial = emptyRead(); partial.live_sources = [{ dataset: 'bank', state: 'unreadable' }];
  const p = body(partial);
  assert.ok(has(p, 'evidence-empty') && p.includes('Mercury could not be read.'), 'the partial-source note is unchanged on first use');
});

test('RA-15 Home: one item draws the dashboard, figures then Needs you then the library beside what investors see', () => {
  const r = emptyRead(); r.items = { state: 'recorded', has_more: false, rows: [item('only')] };
  const out = body(r);
  assert.ok(out.includes('data-mode="home"') && !has(out, 'evidence-empty'));
  for (const id of ['evidence-tiles', 'evidence-claims', 'evidence-items', 'evidence-coverage', 'evidence-investors-see']) assert.ok(has(out, id), id);
  const at = (id) => out.indexOf(`data-testid="${id}"`);
  assert.ok(at('evidence-tiles') < at('evidence-claims'), 'figures first');
  assert.ok(at('evidence-claims') < at('evidence-items'), 'Needs you before the library');
  assert.ok(at('evidence-items') < at('evidence-review-card') && at('evidence-review-card') < at('evidence-investors-see'), 'the right column follows the library');
  assert.ok(at('evidence-investors-see') < at('evidence-coverage'), 'what investors see before coverage');
  assert.ok(at('evidence-opens') < at('evidence-handoff'), 'the hand-off closes the page');
  assert.ok(out.includes('href="/raise/fundraising-readiness?project_id=7"'));
});

test('RA-26a: each claim needing the founder has one action, a 44px target on a phone; a backed current claim and an admin have none', () => {
  const m = viewModel(fullRead());
  const words = Object.fromEntries(m.claims.map((c) => [c.uid, claimAction(c, m.byUid)]));
  assert.deepEqual(words, { 'c-mm': 'Review', 'c-nb': 'Add evidence', 'c-ff': 'Back it', 'c-ok': null, 'c-ch': 'Re-check' });
  assert.equal(claimAction(claim('s', 'backed', { record: { items: ['old'] } }), m.byUid), 'Re-check', 'a stale record');
  assert.equal(claimAction(claim('u', 'unchecked')), null);
  const out = body(fullRead());
  assert.equal(count(out, 'data-testid="claim-action"'), 4);
  assert.match(out, /data-testid="claim-action" href="\/raise\/evidence\/claim\/c-mm\?project_id=7"[^>]*>Review</, 'the action opens the claim');
  for (const tag of out.match(/<a [^>]*data-testid="claim-action"[^>]*>/g)) assert.match(tag, /min-h-\[44px\][^"]*sm:min-h-\[36px\]/);
  assert.equal(count(body(fullRead({ founder: false })), 'data-testid="claim-action"'), 0, 'an admin changes nothing');
  for (const tag of body(emptyRead()).match(/<a [^>]*data-testid="setup-[a-z]+"[^>]*>/g)) assert.match(tag, /min-h-\[44px\]/);
});

test('forbidden and error are unchanged', () => {
  const view = viewOf('/raise/evidence');
  assert.ok(html(h(EvidenceBody, { state: { status: 'forbidden' }, view })).includes('Evidence is for the venture’s founders and the investors they invite.'));
  const err = html(h(EvidenceBody, { state: { status: 'error', message: '' }, view }));
  assert.ok(err.includes('Your evidence could not be read.') && !err.includes('Build your evidence base'));
});
